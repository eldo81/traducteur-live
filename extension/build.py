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
import json, glob, shutil
ver = json.load(open(os.path.join(here, 'manifest.json')))['version']
root = os.path.join(here, '..')
for old in glob.glob(os.path.join(root, 'interprete-live-v*.zip')):
    os.remove(old)
# Nom versionné : le cache de GitHub Pages ne peut pas servir une ancienne version
out = os.path.join(root, f'interprete-live-v{ver}.zip')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(os.path.join(here, f), 'interprete-live/' + f)
shutil.copy(out, os.path.join(root, 'interprete-live-extension.zip'))
# Lien de la page d'installation mis à jour automatiquement
page = os.path.join(root, 'extension.html')
html = open(page, encoding='utf-8').read()
import re
html = re.sub(r'href="interprete-live-(?:extension|v[\d.]+)\.zip"', f'href="interprete-live-v{ver}.zip"', html)
html = re.sub(r'Télécharger l\'extension[^<]*</a>', f"Télécharger l'extension v{ver} (.zip)</a>", html)
open(page, 'w', encoding='utf-8').write(html)
print('OK :', os.path.abspath(out))
