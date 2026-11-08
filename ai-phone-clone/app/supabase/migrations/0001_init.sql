-- Clone AI Phone : schéma V1 (Postgres sur Supabase)
-- Accès : Row Level Security (RLS). Le navigateur n'écrit jamais les crédits,
-- les minutes ni les transcriptions : seul le serveur (clé service_role) le fait.
-- Les invités n'ont pas de compte et ne touchent jamais la base.

create extension if not exists pgcrypto;

-- 1. Profil (1-1 avec auth.users de Supabase)
create table profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  app_language text not null default 'fr' check (app_language in ('fr','en')),
  default_my_lang    text not null default 'fr',
  default_other_lang text not null default 'en',
  default_voice      text not null default 'auto',
  low_balance_alert_seconds integer not null default 120 check (low_balance_alert_seconds >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 2. Salle d'appel (le lien partagé)
create table call_rooms (
  id           uuid primary key default gen_random_uuid(),
  host_id      uuid not null references auth.users(id) on delete cascade,
  link_token   text not null unique,                 -- 22+ caractères aléatoires, dans l'URL
  mode         text not null default 'voice' check (mode in ('voice','video')),
  host_lang    text not null,
  guest_lang   text not null,
  host_voice   text not null default 'auto',
  guest_voice  text not null default 'auto',
  mute_original_host  boolean not null default true,
  mute_original_guest boolean not null default true,
  status       text not null default 'waiting'
               check (status in ('waiting','live','ended','expired')),
  end_reason   text check (end_reason in ('host_hangup','guest_hangup','no_credit','timeout','error')),
  expires_at   timestamptz not null default now() + interval '24 hours',
  started_at   timestamptz,
  ended_at     timestamptz,
  billed_seconds integer not null default 0 check (billed_seconds >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint langs_differ check (host_lang <> guest_lang),
  constraint ended_after_start check (ended_at is null or started_at is null or ended_at >= started_at)
);
create index on call_rooms (host_id, created_at desc);
create index on call_rooms (status, expires_at);
-- Un seul appel actif à la fois par hôte (évite de consommer en double)
create unique index one_live_call_per_host on call_rooms (host_id) where status = 'live';

-- 3. Participants (hôte + 1 invité ; pas de groupe en V1)
create table participants (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references call_rooms(id) on delete cascade,
  role        text not null check (role in ('host','guest')),
  user_id     uuid references auth.users(id) on delete set null,   -- null pour l'invité
  display_name text,
  user_agent  text,
  in_app_browser boolean not null default false,                    -- navigateur intégré WhatsApp détecté
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on participants (room_id);
create unique index one_host_one_guest on participants (room_id, role) where left_at is null;

-- 4. Phrases (sous-titres / transcription)
create table utterances (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references call_rooms(id) on delete cascade,
  host_id     uuid not null references auth.users(id) on delete cascade, -- propriétaire, pour RLS
  speaker     text not null check (speaker in ('host','guest')),
  lang_src    text not null,
  text_src    text not null,
  lang_dst    text not null,
  text_dst    text not null,
  started_at  timestamptz not null,
  ended_at    timestamptz,
  seq         integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (room_id, seq)
);
create index on utterances (room_id, seq);
create index on utterances (host_id);

-- 5. Résumé IA
create table call_summaries (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null unique references call_rooms(id) on delete cascade,
  host_id     uuid not null references auth.users(id) on delete cascade,
  summary     text not null,
  key_points  jsonb not null default '[]',
  lang        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on call_summaries (host_id);

-- 6. Achats (packs de minutes prépayées ; pas d'abonnement + crédits)
create table purchases (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete restrict,  -- garder la trace comptable
  provider      text not null check (provider in ('stripe','paydunya','cinetpay','apple','google','manual')),
  provider_ref  text not null,                       -- id de session / transaction chez le prestataire
  pack_code     text not null,
  seconds       integer not null check (seconds > 0),
  amount_cents  integer not null check (amount_cents >= 0),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),  -- EUR, XOF, USD
  status        text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (provider, provider_ref)                    -- webhook reçu deux fois = un seul achat
);
create index on purchases (user_id, created_at desc);

-- 7. Grand livre des secondes (source de vérité du solde)
create table credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete restrict,
  delta_seconds integer not null check (delta_seconds <> 0),
  reason      text not null check (reason in ('signup_gift','purchase','call','face_to_face','refund','adjustment')),
  purchase_id uuid references purchases(id) on delete restrict,
  room_id     uuid references call_rooms(id) on delete set null,
  tick        integer,                               -- n° de tranche de 15 s facturée dans l'appel
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (purchase_id),                              -- un achat crédité une seule fois
  unique (room_id, tick)                             -- une tranche facturée une seule fois
);
create index on credit_ledger (user_id, created_at desc);
create index on credit_ledger (room_id);

create view credit_balances with (security_invoker = true) as
  select user_id, coalesce(sum(delta_seconds), 0)::integer as balance_seconds
  from credit_ledger group by user_id;

-- Débit atomique : refuse si le solde est insuffisant (appelé par le worker de traduction)
create or replace function debit_call_tick(p_room uuid, p_tick integer, p_seconds integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_balance integer;
begin
  select host_id into v_user from call_rooms where id = p_room for update;
  if v_user is null then raise exception 'room not found'; end if;
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  select coalesce(sum(delta_seconds),0) into v_balance from credit_ledger where user_id = v_user;
  if v_balance < p_seconds then return -1; end if;
  insert into credit_ledger (user_id, delta_seconds, reason, room_id, tick)
    values (v_user, -p_seconds, 'call', p_room, p_tick)
    on conflict (room_id, tick) do nothing;
  if not found then return v_balance; end if;          -- tranche déjà facturée (rejeu)
  update call_rooms set billed_seconds = billed_seconds + p_seconds where id = p_room;
  return v_balance - p_seconds;
end $$;
revoke all on function debit_call_tick(uuid, integer, integer) from public, anon, authenticated;

-- updated_at automatique
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['profiles','call_rooms','participants','utterances','call_summaries','purchases','credit_ledger'] loop
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop; end $$;

-- Profil + cadeau de bienvenue (3 minutes) à l'inscription
create or replace function on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id) values (new.id);
  insert into credit_ledger (user_id, delta_seconds, reason) values (new.id, 180, 'signup_gift');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function on_auth_user_created();

-- RLS : l'hôte lit ses données ; il ne modifie que son profil et crée ses salles.
alter table profiles       enable row level security;
alter table call_rooms     enable row level security;
alter table participants   enable row level security;
alter table utterances     enable row level security;
alter table call_summaries enable row level security;
alter table purchases      enable row level security;
alter table credit_ledger  enable row level security;

create policy own_profile_read   on profiles for select using (user_id = auth.uid());
create policy own_profile_update on profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_rooms_read   on call_rooms for select using (host_id = auth.uid());
create policy own_rooms_insert on call_rooms for insert with check (host_id = auth.uid() and status = 'waiting' and billed_seconds = 0);
-- pas de policy update/delete : statut et facturation changent côté serveur uniquement

create policy own_participants_read on participants for select
  using (exists (select 1 from call_rooms r where r.id = room_id and r.host_id = auth.uid()));
create policy own_utterances_read on utterances for select using (host_id = auth.uid());
create policy own_utterances_delete on utterances for delete using (host_id = auth.uid());   -- RGPD : effacer une transcription
create policy own_summaries_read on call_summaries for select using (host_id = auth.uid());
create policy own_summaries_delete on call_summaries for delete using (host_id = auth.uid());
create policy own_purchases_read on purchases for select using (user_id = auth.uid());
create policy own_ledger_read on credit_ledger for select using (user_id = auth.uid());
