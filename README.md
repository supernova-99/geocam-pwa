# GeoCam

Appareil photo web (PWA) avec :
- une **boussole** en haut à droite (cadran + lecture en degrés et point cardinal) ;
- un **sélecteur de caméra** en haut à gauche (visible seulement si le téléphone expose plusieurs caméras arrière/externes au navigateur) ;
- un **bouton de prise de vue** centré, avec une **minimap ronde** à sa droite, orientée Nord fixe, basculable entre **OpenStreetMap** et **ASIT-VD** (cadastre vaudois, EPSG:2056) d'un tap ;
- un **tableau de coordonnées** pleine largeur en bas d'écran (2 colonnes × 3 lignes) : X / Y (LV95) et altitude Bessel à gauche, latitude / longitude / précision GPS à droite — les coordonnées suisses sont calculées via l'API REFRAME officielle de swisstopo ;
- une **capture fidèle à l'aperçu** : la photo enregistrée reproduit la boussole, le cône de visée et le tableau de coordonnées tels qu'affichés à l'écran (pas juste un bandeau de texte).

Aucune compilation nécessaire : HTML / CSS / JS purs. Fonctionne dans VS Code sans droits admin.

## Déployer avec GitHub Pages (gratuit, HTTPS)

1. Le dépôt doit être **public** (le plan gratuit de GitHub Pages ne fonctionne pas sur un dépôt privé — Settings → General → Danger Zone → Change visibility).
2. Dans le dépôt : **Settings → Pages → Source** → branche `main`, dossier `/ (root)`. Sauvegarde.
3. Ton URL : `https://supernova-99.github.io/geocam-pwa/`. Chaque `git push` sur `main` redéploie automatiquement en ~1 minute.
4. Sur ton téléphone Android, ouvre cette URL dans **Chrome**, autorise caméra / position / capteurs, puis menu ⋮ → **"Ajouter à l'écran d'accueil"**.

Après une mise à jour, pense à un **rechargement forcé** (ou retirer/réajouter l'icône PWA) : le service worker peut garder l'ancienne version en cache un moment.

## Workflow de mise à jour (VS Code → GitHub)

Dossier de travail permanent : le clone Git (pas le dossier issu du zip). Pour chaque modification :

1. Ouvrir le dossier cloné dans VS Code, copier par-dessus les fichiers modifiés.
2. Panneau **Source Control** → vérifier les fichiers listés → message de commit → **✓ Commit**.
3. **Sync Changes** (ou `git push origin main:main` dans le terminal).

### Deux réglages à garder en tête sur ce poste

- **Git est installé en portable** (`C:\PortableApps\PortableGit`), sans droits admin. VS Code le trouve via `git.path` dans les settings, et PowerShell le trouve car le dossier `...\PortableGit\bin` a été ajouté au **PATH utilisateur** (Windows → variables d'environnement de ton compte, pas besoin d'admin).
- **Le dossier de travail est sur un lecteur réseau** (`Y:\`, mappé sur `NAS03ROSSIER`). Git bloque ça par sécurité par défaut ; l'exception a été ajoutée une fois pour toutes avec `git config --global --add safe.directory ...` — pas besoin de la refaire.
- **Éditeur de commit** : configuré sur VS Code plutôt que Vim (`git config --global core.editor "code --wait"`), pour éviter les commandes `:wq` en cas de message de commit sans `-m`.

### Si `git push` est un jour rejeté (« non-fast-forward » / historiques divergents)

Ça arrive si un commit existe sur GitHub que ton dossier local n'a pas encore.

```
git pull origin main
```

Comme c'est un dépôt solo, la fusion se fait presque toujours automatiquement. Si le terminal affiche encore une fusion en attente (`git status` dit *"still merging"* sans conflit listé), il suffit de valider :

```
git commit -m "Merge"
```

Puis repousser : `git push origin main:main`. Répéter le cycle pull → commit → push si le distant a encore bougé entre-temps (rare, mais peut arriver deux fois de suite).

## Tester en local pendant le développement

Ouvrir directement `index.html` en double-cliquant (`file://`) **ne fonctionnera pas** : la caméra et la géolocalisation exigent HTTPS ou `localhost`. Le plus simple reste de pousser sur GitHub Pages à chaque modification et de tester depuis le téléphone.

## Notes techniques

- **Boussole** : `DeviceOrientationEvent` (cap absolu). Fonctionne sans permission explicite sur Android/Chrome. Sur iOS, une permission par site est demandée au clic sur "Activer l'appareil".
- **Sélecteur de caméra** : basé sur `navigator.mediaDevices.enumerateDevices()`, filtre les caméras dont le libellé contient "front"/"user"/"selfie"/"face". Un toast au démarrage indique le nombre de caméras détectées — utile pour diagnostiquer, car **beaucoup de téléphones Android n'exposent qu'une seule caméra arrière aux navigateurs web**, même s'ils ont plusieurs objectifs physiques (grand-angle, téléobjectif) : c'est une limite matérielle/OS, pas un bug de l'app. Le bouton reste caché si une seule caméra est détectée.
- **Coordonnées suisses (X/Y LV95, altitude Bessel)** : calculées via l'API REST REFRAME de swisstopo (`https://geodesy.geo.admin.ch/reframe/wgs84tolv95`), appelée au maximum une fois toutes les 2,5 secondes et seulement si la position a changé. En cas d'échec réseau, un toast discret prévient et les valeurs précédentes restent affichées.
- **Minimap ASIT-VD** : grille officielle EPSG:2056 (30 niveaux), configurée via `proj4leaflet` à partir des vraies valeurs du `GetCapabilities` du service (`wmts.asit-asso.ch`). La couche `asitvd.fond_cadastral` est documentée comme réservée aux membres ASIT — si les tuiles ne chargent pas (toast d'erreur), vérifier les droits d'accès associés au compte/domaine.
- **Minimap OSM** : tuiles publiques OpenStreetMap, usage personnel léger. L'attribution a été retirée pour gagner de la place (cercle de 108 px) — si l'app est un jour partagée publiquement à plus grande échelle, réactiver `attributionControl` dans `app.js` (fonction `buildMap`) pour rester conforme à la [politique d'usage des tuiles OSM](https://operations.osmfoundation.org/policies/tiles/).
- **Capture photo** : composite dessiné entièrement sur `<canvas>` (boussole, cône de visée, minimap, tableau de coordonnées), sans dépendre d'une capture d'écran. Les tuiles de la minimap sont dessinées sur un canvas séparé pour détecter un éventuel blocage CORS sans faire échouer toute la capture ; en cas de blocage, la carte est simplement omise de la photo (toast d'avertissement) mais le reste s'enregistre normalement.
- **Photos** : téléchargées en JPEG dans **Téléchargements**, nom de fichier horodaté.
- **Service worker** : ne met en cache que les fichiers de l'app (HTML/CSS/JS/icônes) — caméra, GPS et tuiles de carte nécessitent toujours une connexion réseau.
