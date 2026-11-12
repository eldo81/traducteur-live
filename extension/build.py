"""Construit extension/main.js (consignes intégrées) et le zip téléchargeable.
Usage : python3 extension/build.py  (depuis la racine du dépôt ou ce dossier)"""
import os, zipfile
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'main.src.js'), encoding='utf-8').read()
prompts = open(os.path.join(here, 'prompts.js'), encoding='utf-8').read()
assert '/*@@PROMPTS@@*/' in src
open(os.path.join(here, 'main.js'), 'w', encoding='utf-8').write(
    '/* FICHIER GÉNÉRÉ par build.py — modifiez main.src.js et prompts.js */\n' + src.replace('/*@@PROMPTS@@*/', prompts))
files = ['manifest.json', 'background.js', 'bridge.js', 'main.js', 'options.html', 'options.js', 'app.html', 'app.css', 'app.js', 'icon-48.png', 'icon-128.png']
out = os.path.join(here, '..', 'interprete-live-extension.zip')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(os.path.join(here, f), 'interprete-live/' + f)
print('OK :', os.path.abspath(out))
