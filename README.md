# GeoCam

Appareil photo web (PWA) avec :
- un bandeau bas affichant latitude / longitude / altitude / précision GPS ;
- une minimap OpenStreetMap orientée Nord fixe, avec ton point et un cône indiquant la direction de la caméra ;
- une boussole (cadran + lecture en degrés et point cardinal).

Aucune compilation nécessaire : HTML / CSS / JS purs. Fonctionne dans VS Code sans droits admin.

## Déployer en 5 minutes avec GitHub Pages (gratuit, HTTPS)

1. Crée un nouveau dépôt sur [github.com](https://github.com) (public ou privé), par ex. `geocam-pwa`.
2. Mets-y tous les fichiers de ce dossier (`index.html`, `style.css`, `app.js`, `sw.js`, `manifest.json`, `icons/`) — soit par `git push`, soit en les glissant directement dans l'interface web GitHub ("Add file" → "Upload files").
3. Dans le dépôt : **Settings → Pages → Source** → choisis la branche `main` et le dossier `/ (root)`. Sauvegarde.
4. Après ~1 minute, ton URL est disponible : `https://TON-PSEUDO.github.io/geocam-pwa/`.
5. Ouvre cette URL sur ton téléphone Android dans **Chrome**, autorise la caméra / position / capteurs quand demandé, puis menu ⋮ → **"Ajouter à l'écran d'accueil"**. L'icône GeoCam apparaît comme une app normale.

## Tester en local pendant le développement

Ouvrir directement `index.html` en double-cliquant (`file://`) **ne fonctionnera pas** : la caméra et la géolocalisation exigent HTTPS ou `localhost`.

Options sans droits admin :
- Extension VS Code **Live Server** (s'installe dans ton profil utilisateur, pas besoin d'admin) → clic droit sur `index.html` → "Open with Live Server". Fonctionne sur l'ordinateur ; pour tester sur le téléphone physique, passe par GitHub Pages.
- Ou pousse directement sur GitHub Pages à chaque modification (le plus simple, et c'est ce qui te servira au final de toute façon).

## Notes techniques

- La boussole utilise `DeviceOrientationEvent` (cap absolu). Sur Android/Chrome cela fonctionne sans permission explicite. Sur iOS, une permission par site est demandée au clic sur "Activer l'appareil".
- Les photos sont téléchargées au format JPEG dans le dossier **Téléchargements** du téléphone (nom du fichier horodaté), avec les coordonnées/altitude/précision/cap incrustées en bas de l'image.
- La minimap utilise les tuiles OpenStreetMap publiques : usage personnel léger uniquement (pas d'usage intensif/commercial sans clé dédiée). L'attribution OSM a été retirée de la minimap pour gagner de la place vu sa petite taille (108 px) — c'est acceptable pour un usage strictement personnel, mais si tu partages un jour l'app publiquement ou à plusieurs personnes, réactive `attributionControl` dans `app.js` (fonction `initMinimap`) pour rester conforme à la [politique d'usage des tuiles OSM](https://operations.osmfoundation.org/policies/tiles/).
- Le service worker ne met en cache que les fichiers de l'app (HTML/CSS/JS/icônes) — la caméra, le GPS et les tuiles de carte nécessitent toujours une connexion réseau.
