# Autoclean-email — Documentation technique et fonctionnelle complète

> Documentation française mise à jour pour l’extension Chrome **Autoclean-email** (v1.0.7).
> Source de vérité de cette révision : le code complet et à jour de l’extension (`manifest.json`, `popup.html`, `popup.js`, `i18n.js`, `background.js`, `api.js`, `auth.js`, `settings.js`) et du backend (`Code.gs`), ainsi que la politique de confidentialité.

---

## Notes de révision — 2026-06-05

Changements de la version **1.0.7** :

- **Correctif d'empaquetage** : le fichier `Code.gs` est de nouveau **inclus dans le package de l'extension**. Dans la 1.0.6 publiée il avait été omis par erreur, ce qui laissait vide l'aperçu du code de la page de configuration (qui le charge via `chrome.runtime.getURL("Code.gs")`). L'aperçu et le bouton « Copier le code » refonctionnent.
- Aucun changement de comportement côté nettoyage : toutes les nouveautés de la 1.0.6 (délai anti-spam d'1 min, version affichée sous le titre, restauration de la progression « Traitement en cours… », liens et logo vers `Snake-Angel`) sont conservées.

---

## Notes de révision — 2026-06-03

Changements de la version **1.0.6** :

- **Délai anti-spam sur le bouton « Delete emails now »** : un nettoyage manuel ne peut désormais être déclenché qu’**une fois par minute** au maximum. Après un clic, le bouton est désactivé et affiche un compte à rebours. L’horodatage du dernier nettoyage est conservé dans `chrome.storage.local` (clé `last_cleanup_at`), de sorte que le délai survit à la fermeture puis à la réouverture du popup.
- **Version affichée dans l’interface** : le numéro de version de l’extension est affiché en petit, juste sous le titre, dans l’en-tête du popup. Il est lu dynamiquement depuis `manifest.json` via `chrome.runtime.getManifest().version` — aucune valeur à maintenir en double.
- **Restauration de la progression en arrière-plan** : si le popup est fermé puis rouvert pendant un import/ajout multiple, le message « Traitement en cours… » est désormais **restauré** et suivi jusqu’à la fin. Le popup lit l’état persisté (`chrome.storage.local.batchState`) au démarrage et écoute `chrome.storage.onChanged` pour les mises à jour suivantes.
- **Lien GitHub mis à jour** : le dépôt référencé dans le popup (et dans l’e-mail récapitulatif) pointe désormais vers `https://github.com/Snake-Angel/Autoclean-email`.
- **En-tête de `Code.gs` allégé** : le long commentaire d’introduction, obsolète, a été remplacé par un en-tête concis et à jour.
- **Manifeste** : passage en version `1.0.6`.

---

## Notes de révision — 2026-05-25

Cette version intègre les dernières modifications déclarées :

- les règles de rétention Apps Script sont désormais stockées dans `RETENTION_RULES_MAP` ;
- les sujets des emails de récapitulatif sont désormais neutres et professionnels :
  - FR : `Récapitulatif Autoclean-email` ;
  - EN : `Autoclean-email cleanup summary` ;
- le nettoyage des anciens récapitulatifs repose sur le marqueur HTML stable `AUTOCLEAN_SUMMARY_EMAIL_v1`, et non plus sur une recherche par sujet exact ;
- la section confidentialité a été simplifiée et alignée avec la politique de confidentialité à jour ;
- les remarques obsolètes liées aux anciens diagrammes ou anciennes constantes ont été retirées.

---

## Table des matières

1. [Vue d’ensemble de l’extension](#1-vue-densemble-de-lextension)
2. [Architecture technique complète](#2-architecture-technique-complète)
3. [Comportement détaillé du frontend](#3-comportement-détaillé-du-frontend)
4. [Comportement détaillé du service worker](#4-comportement-détaillé-du-service-worker)
5. [Comportement détaillé du Google Apps Script](#5-comportement-détaillé-du-google-apps-script)
6. [Comportement côté Gmail](#6-comportement-côté-gmail)
7. [Parcours utilisateur complet](#7-parcours-utilisateur-complet)
8. [Logique métier](#8-logique-métier)
9. [Stockage et données](#9-stockage-et-données)
10. [Communication entre composants](#10-communication-entre-composants)
11. [Sécurité](#11-sécurité)
12. [Liste complète des fonctionnalités](#12-liste-complète-des-fonctionnalités)
13. [Alignement avec la politique de confidentialité](#13-alignement-avec-la-politique-de-confidentialité)
14. [Notes obsolètes retirées](#14-notes-obsolètes-retirées)
15. [Limitations techniques, contraintes et compromis](#15-limitations-techniques-contraintes-et-compromis)
16. [Annexes](#annexes)

---

## 1. Vue d’ensemble de l’extension

### 1.1 Objectif produit

**Autoclean-email** est une extension Chrome Manifest V3 conçue pour automatiser le nettoyage Gmail d’un utilisateur professionnel.

L’extension ne supprime pas les emails via un service tiers. Elle pilote une **Web App Google Apps Script** déployée par l’utilisateur sur son propre compte Google. C’est ce script, exécuté dans l’environnement Google de l’utilisateur, qui effectue les recherches Gmail et déplace les conversations concernées vers la corbeille via l’API native `GmailApp`.

L’utilisateur définit, **par expéditeur**, combien de jours les emails doivent être conservés. Une fois cette durée dépassée, le script peut supprimer les conversations correspondantes lors d’une exécution manuelle ou planifiée.

### 1.2 Problème résolu

Les boîtes Gmail professionnelles accumulent rapidement :

- newsletters récurrentes ;
- notifications produit ;
- emails de suivi issus d’outils d’outbound comme HubSpot, Lemlist, Apollo, etc. ;
- notifications LinkedIn ou digest SaaS ;
- emails utiles quelques jours, puis inutiles ensuite.

Autoclean-email permet de remplacer une gestion manuelle répétitive par une **politique de rétention par expéditeur**.

Au lieu de supprimer les emails un par un, l’utilisateur définit une règle simple :

```txt
Conserver les emails de newsletter@example.com pendant 7 jours, puis les déplacer automatiquement vers la corbeille.
```

### 1.3 Cas d’usage typiques

- Conserver les newsletters Substack 7 jours, puis les supprimer automatiquement.
- Conserver les notifications d’outils d’outbound 3 jours.
- Conserver les notifications LinkedIn 14 jours.
- Lancer un nettoyage ponctuel via le bouton **Delete emails now**.
- Ajouter un expéditeur directement depuis Gmail en appliquant le libellé `Add-sender` à un email.
- Importer une liste d’expéditeurs à partir d’un fichier CSV.
- Exporter la liste actuelle des règles de rétention.

### 1.4 Utilisateurs cibles

D’après le positionnement du produit et le comportement du code, les utilisateurs cibles sont principalement :

- fondateurs ;
- freelances ;
- recruteurs ;
- opérateurs ;
- utilisateurs Gmail recevant un grand volume d’emails récurrents ;
- personnes souhaitant automatiser une partie de leur hygiène email sans confier leur boîte mail à un serveur tiers.

L’extension vise un public bilingue : **français + anglais**, avec i18n dans l’interface et dans les emails de récapitulatif.

### 1.5 Philosophie générale

- **Privacy by design** : aucune donnée n’est envoyée à un serveur externe exploité par le développeur.
- **Données sous contrôle utilisateur** : les règles vivent dans les `ScriptProperties` du script Apps Script de l’utilisateur.
- **Extension Chrome à permissions limitées** : l’extension ne demande pas de scope Gmail direct.
- **Gmail géré par Apps Script** : les permissions Gmail sont détenues par le script déployé par l’utilisateur.
- **OAuth minimal côté extension** : le scope `userinfo.email` sert à authentifier les appels vers la Web App Apps Script.
- **Suppression non définitive** : les conversations sont déplacées vers la corbeille Gmail, pas détruites immédiatement.

### 1.6 Architecture en résumé

```txt
Extension Chrome (Manifest V3)
├── popup.html / popup.js   ← interface principale
├── config.html / config.js ← guide d’installation + saisie de l’URL Web App
├── background.js           ← service worker, batchs CSV / ajouts multiples
├── api.js                  ← couche HTTP, validation, retries, timeout
├── auth.js                 ← OAuth via chrome.identity
├── settings.js             ← chrome.storage.sync, URL Web App
└── i18n.js                 ← traductions FR/EN

Google Apps Script (Web App déployée par l’utilisateur)
└── Code.gs                 ← doPost, dispatcher, nettoyage Gmail,
                              ingestion par libellé, emails de résumé,
                              ScriptProperties
```

---

## 2. Architecture technique complète

### 2.1 Manifest V3 (`manifest.json`)

Structure attendue du manifeste :

```json
{
  "manifest_version": 3,
  "name": "Autoclean Email",
  "version": "1.0.7",
  "description": "Automated Gmail cleanup with sender-based retention rules and scheduled runs.",
  "permissions": ["storage", "identity"],
  "host_permissions": [
    "https://script.google.com/macros/s/*/exec",
    "https://www.gstatic.com/generate_204",
    "https://oauth2.googleapis.com/*"
  ],
  "oauth2": {
    "client_id": "341298656625-fr6g3nkknabms80t7k63phedjf93mq7b.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/userinfo.email"]
  },
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html", "default_title": "Autoclean-email" },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

Points importants :

- l’extension utilise **Manifest V3** ;
- le background est un **service worker module ES** ;
- les permissions Chrome sont limitées à `storage` et `identity` ;
- l’extension ne demande pas d’accès direct à Gmail ;
- les appels réseau autorisés ciblent :
  - les Web Apps Apps Script sur `script.google.com` ;
  - l’API OAuth Google ;
  - `www.gstatic.com/generate_204`, utilisé comme sonde de connectivité réelle (HTTP 204 vide) par `isReallyOnline()` dans `api.js`, en complément de `navigator.onLine`.

### 2.2 Composants principaux

| Composant | Fichier | Type | Responsabilité |
|---|---|---|---|
| Interface popup | `popup.html` + `popup.js` | Module ES | Gestion de la liste, ajout simple, paramètres, import/export CSV, nettoyage manuel. |
| Page de configuration | `config.html` + `config.js` | Module ES | Guide d’installation, copie de `Code.gs`, saisie de l’URL Web App. |
| Service worker | `background.js` | Module ES | Exécution des batchs d’ajout, état de progression, ouverture de la config à l’installation. |
| Couche API | `api.js` | Module ES | POST HTTPS, token OAuth, retries, timeout, validation email/durée. |
| Authentification | `auth.js` | Module ES | `chrome.identity.getAuthToken`, suppression du token en cache si nécessaire. |
| Paramètres | `settings.js` | Module ES | Lecture/écriture de l’URL Web App dans `chrome.storage.sync`. |
| i18n | `i18n.js` | Module ES | Traductions FR/EN, langue UI, langue du résumé côté Apps Script. |
| Backend GAS | `Code.gs` | Apps Script | Dispatcher, règles de rétention, nettoyage Gmail, résumé email, stockage. |

> `Code.gs` est fourni avec l’extension comme texte à copier dans Apps Script. Il n’est pas exécuté dans le navigateur.

### 2.3 Vue dynamique des communications

```txt
┌──────────────────────── EXTENSION CHROME ────────────────────────┐
│                                                                   │
│ popup.html ─► popup.js ─► api.js ── fetch POST ──► Apps Script     │
│                    ▲         │                         Web App     │
│                    │         ▼                                     │
│                    │     auth.js                                   │
│                    │         │                                     │
│                    │         ▼                                     │
│                    │  Google OAuth token                           │
│                    │                                               │
│                    └── chrome.runtime.sendMessage ─► background.js │
│                                                       │           │
│                                                       ▼           │
│                                                    apiPost()       │
│                                                                   │
│ settings.js ◄──► chrome.storage.sync                              │
│ popup.js    ◄──► chrome.storage.local                             │
└───────────────────────────────────────────────────────────────────┘

                          HTTPS POST { action, token, ... }
                                      │
                                      ▼

┌──────────────────── GOOGLE APPS SCRIPT — Code.gs ─────────────────┐
│                                                                   │
│ doPost                                                            │
│  ├─ vérification OAuth via tokeninfo                              │
│  ├─ contrôle de l’audience OAuth                                  │
│  └─ dispatchAction_(action, data)                                 │
│       ├─ list / add / remove / clearAll                           │
│       ├─ settings / setSkipUnread / setLanguage                   │
│       ├─ labelStatus / createLabel                                │
│       └─ runCleanup                                               │
│            ├─ ingestion du libellé Add-sender                     │
│            ├─ recherche Gmail                                     │
│            ├─ application du libellé de traçabilité                │
│            ├─ moveToTrash()                                       │
│            └─ envoi du récapitulatif                              │
│                                                                   │
│ ScriptProperties                                                  │
│  RETENTION_RULES_MAP, DEFAULT_LABEL_DAYS, SKIP_UNREAD,            │
│  SKIP_SUMMARY_CLEANUP, TOTAL_DELETED_EMAILS, LANG,                │
│  SUMMARY_RECIPIENT                                                │
└───────────────────────────────────────────────────────────────────┘
```

### 2.4 Communications réseau

| Direction | Protocole | Endpoint |
|---|---|---|
| Popup/background → Apps Script | HTTPS POST | URL Web App `script.google.com/.../exec` configurée par l’utilisateur |
| Extension → Google OAuth | HTTPS via Chrome Identity | OAuth Google |
| Apps Script → Google OAuth | HTTPS GET | `https://oauth2.googleapis.com/tokeninfo?access_token=...` |
| Apps Script → Gmail/Mail | APIs internes Google | `GmailApp`, `MailApp` |

L’extension ne contacte pas de serveur tiers exploité par le développeur.

### 2.5 Persistance

| Stockage | Clés | Contenu |
|---|---|---|
| `chrome.storage.sync` | `autocleanConfig` | `{ webAppUrl: string }` |
| `chrome.storage.sync` | `themeChoice` | `auto`, `light`, `dark` |
| `chrome.storage.sync` | `languageChoice` | `fr`, `en` |
| `chrome.storage.local` | `cached_senders_list` | Cache de la liste des expéditeurs/règles |
| `chrome.storage.local` | `cached_global_settings` | Cache des paramètres globaux |
| `chrome.storage.local` | `batchState` | État du batch en cours |
| `chrome.storage.local` | `ac_netfail` | Compteur local d’échecs réseau récents |
| `localStorage` | `ac_theme` | Thème de la page `config.html` |
| Apps Script `ScriptProperties` | `RETENTION_RULES_MAP` | Map JSON `{ email: { days } }` |
| Apps Script `ScriptProperties` | `DEFAULT_LABEL_DAYS` | Durée par défaut pour les ajouts via libellé |
| Apps Script `ScriptProperties` | `SKIP_UNREAD` | Protection des emails non lus |
| Apps Script `ScriptProperties` | `SKIP_SUMMARY_CLEANUP` | Conservation des emails de récapitulatif |
| Apps Script `ScriptProperties` | `TOTAL_DELETED_EMAILS` | Compteur cumulatif des emails supprimés |
| Apps Script `ScriptProperties` | `LANG` | Langue du récapitulatif |
| Apps Script `ScriptProperties` | `SUMMARY_RECIPIENT` | Destinataire du récapitulatif |

### 2.6 Système de batch

Le service worker gère les ajouts multiples, utilisés par :

- l’ajout de plusieurs adresses dans le popup ;
- l’import CSV.

Fonctionnement :

1. création d’un `jobId` ;
2. normalisation et validation des entrées ;
3. persistance de l’état initial dans `chrome.storage.local.batchState` ;
4. ajout séquentiel des règles via `apiPost({ action: "add", email, days })` ;
5. retries par entrée ;
6. émission d’événements `batchAddProgress` ;
7. nettoyage différé de l’état après la fin du batch.

Les ajouts sont séquentiels volontairement pour éviter de heurter les quotas Apps Script. Parce que visiblement même supprimer des newsletters doit être fait avec diplomatie algorithmique.

### 2.7 Retries et gestion d’erreurs

- la couche API retente les appels en cas de `401` ou `403` ;
- le token OAuth peut être retiré du cache puis redemandé ;
- chaque ajout dans un batch peut être tenté plusieurs fois ;
- un `AbortController` limite les appels longs ;
- la détection « hors ligne » utilise `isReallyOnline()` : court-circuit sur `navigator.onLine === false`, sinon `fetch` vers `https://www.gstatic.com/generate_204` avec `AbortController` et timeout de `CONNECTIVITY_TIMEOUT_MS` (4 s). Si la sonde échoue, l'erreur `network_offline` est levée. Ce test n'est exécuté que dans le chemin d'échec d'`apiPost`, donc aucune latence ajoutée sur le chemin nominal ;
- certains échecs techniques peuvent déclencher une purge de la configuration locale et une redirection vers `config.html`.

### 2.8 Libellés Gmail côté serveur

| Libellé | Rôle |
|---|---|
| `Add-sender` | Permet d’ajouter un expéditeur à la liste directement depuis Gmail. |
| `Suppression-Autoclean` | Marque les conversations déplacées vers la corbeille afin de les retrouver/restaurer plus facilement. |

---

## 3. Comportement détaillé du frontend

### 3.1 Vue générale du popup

Le popup contient :

1. un header avec le nom du produit, le numéro de version (affiché en petit sous le titre) et l’accès aux paramètres ;
2. une zone principale avec la liste des expéditeurs, le formulaire d’ajout et le bouton de nettoyage ;
3. un footer d’aide lié au libellé `Add-sender` ;
4. un menu de paramètres flottant.

Le menu de paramètres permet de gérer :

- le thème ;
- la langue ;
- la conservation des récapitulatifs ;
- l’ignorance des emails non lus ;
- la durée par défaut des ajouts via libellé ;
- l’export CSV ;
- l’import CSV ;
- la suppression complète de la liste de règles.

### 3.2 Anti-flicker au démarrage

Le document démarre avec un état de chargement afin d’éviter un affichage partiel avant application du thème et de la langue.

Séquence :

1. afficher l’écran d’initialisation ;
2. charger thème et langue ;
3. vérifier la configuration ;
4. afficher le cache local si disponible ;
5. synchroniser avec Apps Script ;
6. passer l’interface en état prêt.

### 3.3 Thème

Trois choix sont disponibles :

- `auto` ;
- `light` ;
- `dark`.

Le choix est stocké dans `chrome.storage.sync.themeChoice`.

En mode `auto`, l’interface suit `prefers-color-scheme`.

### 3.4 Internationalisation

Langues supportées :

- français ;
- anglais.

Le choix de langue affecte :

- les textes du popup ;
- les textes de la page de configuration ;
- les statuts affichés ;
- la langue synchronisée côté Apps Script pour les emails de récapitulatif.

La langue est stockée dans `chrome.storage.sync.languageChoice`.

### 3.5 Rendu de la liste des expéditeurs

La liste :

- trie les emails alphabétiquement ;
- affiche un nombre limité d’éléments visibles par défaut ;
- propose un bouton pour afficher davantage d’expéditeurs ;
- montre pour chaque entrée :
  - l’adresse email ;
  - la durée de rétention ;
  - un bouton de suppression ;
- affiche un état vide si aucune règle n’est configurée.

### 3.6 Formulaire d’ajout

Champs principaux :

- email(s) d’expéditeur ;
- nombre de jours de rétention.

Le champ email peut accepter plusieurs adresses selon le parsing prévu côté popup.

Le champ jours :

- accepte uniquement des valeurs numériques ;
- borne la valeur maximale à `999` ;
- rejette les valeurs invalides.

Au clic sur l’ajout, le popup envoie un message `batchAdd` au service worker.

### 3.7 Menu des paramètres

| Élément | Comportement |
|---|---|
| Thème | Stockage local synchronisé puis application immédiate. |
| Langue | Changement UI + synchronisation côté Apps Script via `setLanguage`. |
| Conserver les récapitulatifs | Met à jour `SKIP_SUMMARY_CLEANUP`. |
| Ignorer les non lus | Met à jour `SKIP_UNREAD`. |
| Durée par défaut via libellé | Met à jour `DEFAULT_LABEL_DAYS`. |
| Export CSV | Génère un fichier `email;days`. |
| Import CSV | Parse le fichier puis lance un batch d’ajout. |
| Clear list | Réinitialise `RETENTION_RULES_MAP`. |

### 3.8 Bouton “Delete emails now”

Le bouton déclenche :

```js
apiPost({ action: "runCleanup" })
```

Côté serveur, cela lance la logique de nettoyage Gmail.

À la fin :

- la liste est rafraîchie ;
- un statut indique le nombre de conversations supprimées ;
- un email de récapitulatif est envoyé si applicable.

**Délai anti-spam (1 minute).** Pour éviter les déclenchements répétés, le bouton impose un délai minimal d’une minute entre deux nettoyages manuels :

- au clic, l’horodatage courant est enregistré dans `chrome.storage.local` (clé `last_cleanup_at`) ;
- le bouton est immédiatement désactivé et affiche un compte à rebours (« Veuillez patienter N s… ») jusqu’à expiration du délai (`RUN_CLEANUP_COOLDOWN_MS = 60 000 ms`) ;
- l’état étant persisté, le délai est correctement restauré si le popup est fermé puis rouvert (`refreshCleanupCooldown_()` est rappelé au bootstrap) ;
- à l’expiration, le libellé d’origine est rétabli et le bouton réactivé.

### 3.9 Parsing CSV

Format attendu :

```csv
email;days
newsletter@example.com;7
notifications@example.com;14
```

Caractéristiques :

- séparateur `;` ;
- header optionnel ;
- UTF-8 BOM ignoré si présent ;
- email en première colonne ;
- durée en deuxième colonne ;
- valeur par défaut possible si la durée est absente ou invalide selon la logique du parseur.

Limite connue : les CSV séparés par virgules ne sont pas le format principal prévu.

### 3.10 Bootstrap du popup

Séquence simplifiée :

```txt
1. Initialisation UI
2. Chargement thème + langue
3. Vérification de la Web App URL
4. Redirection vers config.html si non configuré
5. Lecture du cache local
6. Affichage de l’UI
7. Synchronisation réseau
8. Gestion des erreurs éventuelles
```

### 3.11 État non configuré

Si aucune URL Web App valide n’est configurée :

- le popup ouvre `config.html` ;
- le popup se ferme ;
- l’utilisateur doit coller l’URL `/exec` de sa Web App Apps Script.

### 3.12 Page de configuration

La page `config.html` guide l’utilisateur en trois étapes :

1. créer un projet Apps Script ;
2. copier-coller `Code.gs` ;
3. déployer en Web App ;
4. créer les déclencheurs éventuels ;
5. exécuter `setup()` ;
6. copier l’URL `/exec` ;
7. la coller dans l’extension.

La page propose aussi un bouton de copie du code et des aides visuelles.

---

## 4. Comportement détaillé du service worker

### 4.1 Rôle

Le service worker `background.js` a deux responsabilités principales :

1. ouvrir la page `config.html` lors de la première installation si aucune URL Web App n’est configurée ;
2. gérer les batchs d’ajout d’expéditeurs.

Il ne déclenche pas directement le nettoyage Gmail hors action utilisateur ou workflow prévu par le popup.

### 4.2 Cycle de vie

Comme tout service worker Manifest V3, il peut être arrêté entre deux activations.

Pour limiter les pertes d’état :

- l’état du batch est écrit dans `chrome.storage.local.batchState` ;
- les progrès sont diffusés via `chrome.runtime.sendMessage` ;
- le popup peut recevoir les mises à jour lorsqu’il est ouvert.

### 4.3 Listener principal

Le service worker écoute les messages internes de l’extension.

Il traite principalement :

```txt
action: "batchAdd"
```

Les messages venant d’autres extensions sont rejetés via vérification de `sender.id`.

### 4.4 `runBatchAdd(msg, sendResponse)`

Deux formes d’entrée sont supportées :

```js
{ entries: [{ email, days }, ...] }
```

ou :

```js
{ emails: [...], days: 7 }
```

Étapes :

1. générer un `jobId` ;
2. normaliser les emails ;
3. valider emails et durées ;
4. ignorer les entrées invalides ;
5. écrire l’état initial ;
6. appeler `apiPost({ action: "add", email, days })` pour chaque entrée ;
7. mettre à jour `ok`, `ko`, `processed` ;
8. diffuser la progression ;
9. retourner l’état final ;
10. nettoyer l’état après un délai.

### 4.5 Ajout individuel

L’ajout individuel :

- valide la durée ;
- appelle l’API Apps Script ;
- retente en cas d’échec temporaire ;
- retourne `true` ou `false`.

### 4.6 Diffusion de progression

Le service worker envoie :

```js
{
  type: "batchAddProgress",
  jobId,
  total,
  processed,
  ok,
  ko,
  status
}
```

Si aucun popup n’écoute, l’erreur runtime est ignorée. Le batch continue.

**Persistance et restauration.** À chaque étape, l’état est aussi écrit dans `chrome.storage.local.batchState`. Ainsi, si le popup est fermé puis rouvert pendant un import/ajout, il **restaure la progression** : au démarrage, `restoreBatchProgress_()` (popup) relit cet état et, via un observateur `chrome.storage.onChanged`, suit le batch jusqu’à la fin (réactivation du bouton « Ajouter », rafraîchissement de la liste, message « Terminé »). Le service worker efface l’état environ 15 s après la fin du job.

### 4.7 Installation

Au premier `onInstalled` :

- si une URL Web App est déjà présente, rien n’est ouvert ;
- sinon, `config.html` est ouverte automatiquement.

### 4.8 Optimisations notables

- les ajouts sont séquentiels, pas parallèles ;
- une courte pause limite la pression sur Apps Script ;
- l’état de batch est persisté ;
- le popup n’est pas bloqué pendant les imports ou ajouts multiples.

---

## 5. Comportement détaillé du Google Apps Script

### 5.1 Constantes principales

Constantes fonctionnelles attendues :

```js
const PROPS_RETENTION_RULES_KEY = 'RETENTION_RULES_MAP';
const PROPS_DEFAULT_LABEL_DAYS_KEY = 'DEFAULT_LABEL_DAYS';
const PROPS_SKIP_UNREAD_KEY = 'SKIP_UNREAD';
const PROPS_SKIP_SUMMARY_CLEANUP_KEY = 'SKIP_SUMMARY_CLEANUP';
const PROPS_TOTAL_DELETED_KEY = 'TOTAL_DELETED_EMAILS';
const PROPS_LANG_KEY = 'LANG';
const PROPS_SUMMARY_RECIPIENT_KEY = 'SUMMARY_RECIPIENT';

const MAX_SENDERS_PER_QUERY = 18;
const MAX_THREADS_TO_DELETE_PER_RUN = 200;
const MAX_RETENTION_DAYS = 999;

const DEFAULT_ADD_LABEL = 'Add-sender';
const AUTOCLEAN_TRACKING_LABEL = 'Suppression-Autoclean';

const SUMMARY_BODY_MARKER = 'AUTOCLEAN_SUMMARY_EMAIL_v1';

const SUBJECT_FR = 'Récapitulatif Autoclean-email';
const SUBJECT_EN = 'Autoclean-email cleanup summary';
```

> Remarque : le nom exact de la constante interne qui pointe vers `RETENTION_RULES_MAP` peut varier si le fichier `Code.gs` complet n’a pas été fourni. Le nom de propriété Apps Script confirmé est bien `RETENTION_RULES_MAP`.

### 5.2 Authentification OAuth

Chaque requête reçue par Apps Script contient un token OAuth transmis par l’extension.

Le script :

1. récupère le token ;
2. appelle `https://oauth2.googleapis.com/tokeninfo` ;
3. vérifie que le token est valide ;
4. vérifie que l’audience correspond au client OAuth de l’extension ;
5. rejette les tokens invalides, expirés ou provenant d’une autre application.

Ce système évite un secret statique codé en dur.

### 5.3 `doPost(e)` et dispatcher

Le point d’entrée Apps Script :

1. parse le JSON reçu ;
2. valide le token OAuth ;
3. lit `action` ;
4. route vers la fonction correspondante ;
5. renvoie une réponse JSON standardisée.

Format de réponse :

```json
{ "status": "ok", "...": "..." }
```

ou :

```json
{ "status": "error", "error": "code", "message": "..." }
```

#### Actions supportées

| Action | Entrée | Effet |
|---|---|---|
| `list` | aucune | Retourne la map des règles. |
| `settings` | aucune | Retourne les paramètres globaux. |
| `setSettings` | paramètres partiels | Met à jour plusieurs paramètres. |
| `labelStatus` | aucune | Indique si `Add-sender` existe. |
| `createLabel` | aucune | Crée `Add-sender` si nécessaire. |
| `setLanguage` | `{ lang }` | Change la langue des résumés. |
| `setDefaultLabelDays` | `{ days }` | Change la durée par défaut via libellé. |
| `add` | `{ email, days }` | Ajoute ou met à jour une règle. |
| `remove` | `{ email }` | Supprime une règle. |
| `clearAll` | aucune | Réinitialise `RETENTION_RULES_MAP`. |
| `runCleanup` | aucune | Lance un nettoyage Gmail. |
| `setSkipUnread` | `{ skipUnread }` | Active/désactive la protection des non lus. |
| `setSkipSummaryCleanup` | `{ skipSummaryCleanup }` | Active/désactive la conservation des récapitulatifs. |

### 5.4 `setup()`

La fonction `setup()` doit être exécutée manuellement par l’utilisateur après déploiement.

Elle sert à :

- récupérer l’URL Web App ;
- convertir éventuellement `/dev` en `/exec` ;
- initialiser `SUMMARY_RECIPIENT` ;
- créer le libellé `Add-sender` si besoin ;
- afficher l’URL à copier dans les logs Apps Script.

### 5.5 Nettoyage Gmail

La fonction centrale, appelée par `runCleanup` ou par un déclencheur Apps Script, effectue les opérations suivantes :

1. verrouiller l’exécution avec `LockService` ;
2. lire la langue ;
3. nettoyer les anciens récapitulatifs si `SKIP_SUMMARY_CLEANUP` est désactivé ;
4. charger `RETENTION_RULES_MAP` ;
5. ingérer les ajouts faits via le libellé `Add-sender` ;
6. arrêter si aucune règle n’est configurée ;
7. construire les requêtes Gmail par paquets d’expéditeurs ;
8. rechercher les conversations éligibles ;
9. dédupliquer les conversations ;
10. limiter le nombre de suppressions par run ;
11. construire le récapitulatif ;
12. appliquer le libellé `Suppression-Autoclean` ;
13. déplacer les conversations vers la corbeille ;
14. incrémenter `TOTAL_DELETED_EMAILS` ;
15. envoyer l’email de récapitulatif ;
16. retourner le nombre de conversations supprimées.

### 5.6 Construction des requêtes Gmail

Pour chaque règle :

```txt
from:email@example.com older_than:7d
```

Si la protection des non lus est active :

```txt
from:email@example.com older_than:7d -is:unread
```

Plusieurs clauses peuvent être regroupées avec `OR`.

Exemple :

```txt
(from:a@example.com older_than:7d -is:unread) OR (from:b@example.com older_than:30d -is:unread)
```

### 5.7 Ingestion via libellé `Add-sender`

L’utilisateur peut ajouter un expéditeur sans passer par le popup :

1. il applique le libellé `Add-sender` à un email dans Gmail ;
2. au prochain nettoyage, le script lit le premier message de la conversation ;
3. il extrait l’expéditeur ;
4. il ajoute cet expéditeur à `RETENTION_RULES_MAP` avec `DEFAULT_LABEL_DAYS` ;
5. il retire le libellé `Add-sender` de la conversation.

Si l’expéditeur existe déjà dans la map, sa durée existante est conservée.

### 5.8 Nettoyage des anciens récapitulatifs

Le nettoyage des anciens emails de récapitulatif repose désormais sur un marqueur stable inclus dans le corps HTML :

```txt
AUTOCLEAN_SUMMARY_EMAIL_v1
```

Avantages :

- le nettoyage ne dépend plus du sujet ;
- le sujet peut évoluer sans casser la détection ;
- la langue du récapitulatif n’a plus d’impact sur l’identification ;
- les anciens récapitulatifs peuvent être retrouvés de manière plus robuste.

La préférence `SKIP_SUMMARY_CLEANUP` permet de conserver ces récapitulatifs si l’utilisateur le souhaite.

### 5.9 Email de récapitulatif

#### Sujet

- FR : `Récapitulatif Autoclean-email`
- EN : `Autoclean-email cleanup summary`

#### Corps HTML

Le récapitulatif contient typiquement :

- un marqueur caché `AUTOCLEAN_SUMMARY_EMAIL_v1` ;
- un préheader ;
- un header avec le nom du produit ;
- le nombre d’emails ou conversations supprimés ;
- une estimation du temps économisé ;
- un cumul depuis l’installation ;
- une table des conversations supprimées ;
- un footer avec liens utiles.

#### Calcul du temps économisé

Le modèle utilisé est approximatif :

```txt
10 secondes économisées par email supprimé
```

Ce chiffre sert uniquement d’indicateur UX.

#### État vide

Si des règles existent mais qu’aucune conversation ne correspond, un récapitulatif peut indiquer qu’aucun email n’a été supprimé.

Si aucune règle n’est configurée, le script peut retourner directement sans envoyer de résumé.

### 5.10 Verrouillage et concurrence

Le script utilise `LockService` pour éviter deux exécutions concurrentes.

Cas concernés :

- clic manuel sur “Delete emails now” pendant un déclencheur planifié ;
- deux déclencheurs trop proches ;
- modification de règles pendant un nettoyage.

Le verrou protège notamment les lectures/écritures dans `ScriptProperties`.

### 5.11 Quotas et limites Apps Script

| Limite | Valeur | Rôle |
|---|---:|---|
| Expéditeurs par requête Gmail | 18 | Évite les requêtes trop longues. |
| Conversations déplacées par run | 200 | Limite les risques de timeout. |
| Durée de rétention maximale | 999 jours | Cohérence frontend/backend. |
| Timeout API côté extension | environ 2 min | Évite les appels suspendus. |
| Verrou Apps Script | environ 10 s | Évite les écritures concurrentes. |

---

## 6. Comportement côté Gmail

### 6.1 Recherche des emails

Le script utilise `GmailApp.search()`.

Important : Gmail retourne des **conversations** (`GmailThread`), pas des emails isolés.

Conséquence : si une conversation contient un email d’un expéditeur ciblé et d’autres messages, c’est la conversation entière qui peut être déplacée vers la corbeille.

### 6.2 Application des règles

Pour chaque règle :

```txt
expéditeur + durée de rétention + protection éventuelle des non lus
```

Exemple :

```txt
newsletter@example.com → 7 jours
```

La conversation devient éligible si son dernier message est plus ancien que 7 jours.

### 6.3 Libellés Gmail

| Libellé | Fonction |
|---|---|
| `Add-sender` | Déclenche l’ajout automatique de l’expéditeur aux règles. |
| `Suppression-Autoclean` | Marque les conversations déplacées vers la corbeille. |

### 6.4 Sélection des conversations

Algorithme simplifié :

```txt
Pour chaque paquet d’expéditeurs :
  construire une requête Gmail
  rechercher les conversations correspondantes
  dédupliquer par ID
  arrêter à la limite maximale du run
```

Les conversations sont ensuite traitées une seule fois.

### 6.5 Déplacement vers la corbeille

Le script utilise :

```js
thread.moveToTrash()
```

Cela déplace la conversation dans la corbeille Gmail.

Ce n’est pas une suppression définitive immédiate. Gmail purge généralement la corbeille automatiquement après 30 jours.

### 6.6 Protection des emails non lus

Si `SKIP_UNREAD` vaut `true`, la requête inclut :

```txt
-is:unread
```

Les conversations contenant des messages non lus sont donc exclues.

### 6.7 Gestion des récapitulatifs

Après chaque nettoyage applicable, le script envoie un email de récapitulatif au compte utilisateur.

Sauf si la conservation est activée, les anciens récapitulatifs sont nettoyés lors des runs suivants grâce au marqueur :

```txt
AUTOCLEAN_SUMMARY_EMAIL_v1
```

### 6.8 Fonctionnement de la rétention

La rétention repose sur `older_than:Nd`.

Cela signifie que Gmail évalue l’âge de la conversation selon son activité. Si une nouvelle réponse arrive dans une conversation, l’âge de la conversation est réinitialisé du point de vue de la recherche Gmail.

---

## 7. Parcours utilisateur complet

### 7.1 Installation

1. L’utilisateur installe l’extension Chrome.
2. Si aucune URL Web App n’est configurée, `config.html` s’ouvre.
3. L’utilisateur suit le guide d’installation Apps Script.

### 7.2 Configuration Apps Script

Étapes :

1. ouvrir Google Apps Script ;
2. créer un projet ;
3. remplacer le code par `Code.gs` fourni ;
4. déployer comme Web App ;
5. choisir l’exécution en tant que soi-même ;
6. autoriser les permissions demandées ;
7. exécuter `setup()` ;
8. copier l’URL `/exec` ;
9. coller l’URL dans l’extension.

### 7.3 Connexion OAuth

Lors de la première utilisation, Chrome peut demander une autorisation OAuth.

Le scope demandé côté extension est :

```txt
https://www.googleapis.com/auth/userinfo.email
```

Ce scope ne donne pas accès au contenu Gmail.

### 7.4 Ajout manuel d’un expéditeur

1. Ouvrir l’extension.
2. Saisir une ou plusieurs adresses email.
3. Choisir une durée de rétention.
4. Cliquer sur le bouton d’ajout.
5. Le service worker lance un batch.
6. La liste est mise à jour.

### 7.5 Ajout via Gmail

1. Dans Gmail, sélectionner une conversation.
2. Appliquer le libellé `Add-sender`.
3. Au prochain nettoyage, Apps Script lit l’expéditeur.
4. L’expéditeur est ajouté avec `DEFAULT_LABEL_DAYS`.
5. Le libellé est retiré.

### 7.6 Suppression d’un expéditeur

Dans le popup :

1. cliquer sur `Remove` ;
2. envoyer `remove` à Apps Script ;
3. mettre à jour `RETENTION_RULES_MAP` ;
4. rafraîchir la liste.

### 7.7 Nettoyage manuel

1. Cliquer sur **Delete emails now**.
2. Le popup affiche un statut de nettoyage.
3. Apps Script exécute `runCleanup`.
4. Les conversations éligibles sont déplacées vers la corbeille.
5. Un récapitulatif est envoyé.
6. Le popup affiche le nombre supprimé.

### 7.8 Lecture du récapitulatif

L’email de résumé indique :

- le nombre supprimé ;
- le temps estimé économisé ;
- le total depuis l’installation ;
- les conversations concernées.

### 7.9 Export CSV

L’export génère un fichier :

```csv
email;days
newsletter@example.com;7
```

Nom de fichier attendu :

```txt
Autoclean_e-mail_YYYY-MM-DD.csv
```

### 7.10 Import CSV

L’utilisateur sélectionne un fichier CSV.

L’extension :

1. lit le fichier ;
2. parse les lignes ;
3. extrait emails et durées ;
4. ignore les entrées invalides ;
5. lance un batch d’ajout.

### 7.11 Automatisation

Pour automatiser les nettoyages, l’utilisateur crée un déclencheur Apps Script sur la fonction planifiée prévue, par exemple :

```txt
scheduledCleanup()
```

Fréquence possible :

- horaire ;
- quotidienne ;
- personnalisée selon les options Apps Script.

### 7.12 Clear list

La fonction `Clear list` vide les règles de rétention.

Elle ne réinitialise pas forcément :

- la langue ;
- le compteur total ;
- les préférences globales ;
- le destinataire du résumé ;
- les libellés Gmail.

### 7.13 Changement de langue

Le changement de langue :

- met à jour l’interface ;
- synchronise la langue côté Apps Script ;
- affecte les futurs emails de récapitulatif.

### 7.14 Changement de thème

Le changement de thème affecte l’apparence de l’extension.

Il ne modifie aucune donnée Apps Script.

---

## 8. Logique métier

### 8.1 Philosophie des règles

Le produit repose sur une logique simple :

```txt
expéditeur → nombre de jours de conservation
```

Il ne cherche pas à créer un moteur complexe de règles Gmail. Le but est de résoudre un problème fréquent avec une interface simple.

### 8.2 Stratégie de nettoyage

Autoclean-email privilégie :

- la suppression par conversation ;
- la limitation du nombre de conversations traitées par run ;
- la protection optionnelle des non lus ;
- la traçabilité via libellé ;
- le déplacement vers la corbeille plutôt que la suppression définitive.

### 8.3 Garde-fous intégrés

- validation email ;
- durée bornée entre 1 et 999 jours ;
- protection des non lus ;
- limite de conversations supprimées par run ;
- verrou Apps Script ;
- labels de traçabilité ;
- résumé envoyé après nettoyage ;
- retries sur erreurs d’authentification.

### 8.4 Priorités et cas limites

| Cas | Comportement |
|---|---|
| Aucune règle configurée | Aucun nettoyage utile, retour sans suppression. |
| Email déjà dans la map | Mise à jour ou conservation selon le chemin utilisé. |
| Ajout via libellé déjà existant | La durée existante est conservée. |
| Conversation non lue | Exclue si `SKIP_UNREAD` est actif. |
| Trop de conversations éligibles | Traitement limité au maximum prévu par run. |
| Ancien récapitulatif | Nettoyé via marqueur stable si conservation désactivée. |

### 8.5 Compromis techniques

- Apps Script est simple à déployer, mais soumis à quotas.
- Gmail agit par conversations, pas emails unitaires.
- Le modèle par expéditeur est simple, mais moins fin qu’un moteur de règles complet.
- Le CSV `;` est clair pour l’Europe, mais moins universel qu’un parseur CSV complet.
- Le nettoyage par marqueur HTML est plus robuste que le sujet, mais dépend de la présence du marqueur dans les emails générés.

### 8.6 Limitations connues

- Les conversations entières sont déplacées vers la corbeille.
- Les quotas Apps Script peuvent limiter les gros nettoyages.
- Les anciens résumés sans marqueur peuvent ne pas être détectés par la nouvelle logique.
- L’import CSV n’est pas un parseur CSV avancé complet.
- Le service worker MV3 peut être arrêté par Chrome.
- Les données sont liées au projet Apps Script déployé par l’utilisateur.

---

## 9. Stockage et données

### 9.1 `chrome.storage.sync`

Clés principales :

| Clé | Contenu |
|---|---|
| `autocleanConfig` | URL Web App Apps Script. |
| `themeChoice` | Thème choisi. |
| `languageChoice` | Langue choisie. |

Ces données peuvent être synchronisées par Chrome selon la configuration du navigateur.

### 9.2 `chrome.storage.local`

Clés principales :

| Clé | Contenu |
|---|---|
| `cached_senders_list` | Cache local de la liste d’expéditeurs. |
| `cached_global_settings` | Cache local des paramètres Apps Script. |
| `batchState` | État d’un import ou ajout multiple. |
| `ac_netfail` | Compteur local d’échecs réseau. |

Ces données restent locales au navigateur.

### 9.3 `localStorage`

La page `config.html` peut utiliser `localStorage` pour son thème propre.

Cette séparation évite de dépendre de toute l’initialisation du popup pour afficher correctement la page de configuration.

### 9.4 Apps Script — `ScriptProperties`

| Clé | Contenu |
|---|---|
| `RETENTION_RULES_MAP` | Règles de rétention par expéditeur. |
| `DEFAULT_LABEL_DAYS` | Durée par défaut pour le libellé `Add-sender`. |
| `SKIP_UNREAD` | Protection des non lus. |
| `SKIP_SUMMARY_CLEANUP` | Conservation ou nettoyage des résumés. |
| `TOTAL_DELETED_EMAILS` | Compteur cumulatif. |
| `LANG` | Langue du résumé. |
| `SUMMARY_RECIPIENT` | Destinataire du résumé. |

### 9.5 Données Gmail manipulées temporairement

Le script peut lire temporairement :

- l’expéditeur d’une conversation ;
- le sujet ;
- la date ;
- l’état de lecture via la requête Gmail ;
- les conversations correspondant aux règles.

Ces informations servent au nettoyage et au récapitulatif.

### 9.6 Formats utilisés

| Format | Usage |
|---|---|
| JSON | Communications extension ↔ Apps Script. |
| CSV `email;days` | Import/export des règles. |
| HTML email | Récapitulatif de nettoyage. |
| `ScriptProperties` | Persistance Apps Script. |

---

## 10. Communication entre composants

### 10.1 Popup → Background

Utilisé pour les batchs :

```js
chrome.runtime.sendMessage({ action: "batchAdd", ... })
```

Le background renvoie un état final et émet des messages de progression.

### 10.2 Popup → Apps Script

Utilisé pour :

- lire la liste ;
- lire les paramètres ;
- ajouter/supprimer une règle ;
- lancer un nettoyage ;
- modifier les préférences.

Les appels passent par `api.js`.

### 10.3 Background → Apps Script

Utilisé pendant les batchs.

Chaque entrée valide déclenche un appel d’ajout vers Apps Script.

### 10.4 Apps Script → Gmail/Mail

Apps Script utilise :

- `GmailApp` pour rechercher et déplacer les conversations ;
- `MailApp` pour envoyer les récapitulatifs ;
- `PropertiesService` pour stocker les règles et préférences ;
- `LockService` pour éviter les conflits.

### 10.5 Apps Script → Google OAuth

Apps Script vérifie les tokens reçus avec :

```txt
https://oauth2.googleapis.com/tokeninfo
```

### 10.6 Progression et synchronisation

Pendant un batch :

1. le background traite les entrées une par une ;
2. il met à jour l’état local ;
3. il envoie des messages `batchAddProgress` ;
4. le popup met à jour l’interface.

### 10.7 Synchronisation du cache

Le popup utilise le cache pour afficher rapidement la liste, puis tente une synchronisation réseau.

En cas d’échec réseau, l’interface peut rester exploitable partiellement avec les données en cache.

---

## 11. Sécurité

### 11.1 Modèle de menace

Objectifs de sécurité :

- empêcher qu’une autre application utilise la Web App Apps Script ;
- limiter les permissions de l’extension ;
- éviter un serveur intermédiaire ;
- garder les règles dans l’environnement Google de l’utilisateur ;
- éviter les suppressions définitives immédiates ;
- rendre les suppressions traçables.

### 11.2 Système de token

L’extension obtient un token OAuth via Chrome.

Apps Script vérifie :

- validité du token ;
- expiration ;
- audience OAuth ;
- correspondance avec le client ID attendu.

Le token n’est pas stocké directement dans les données de l’extension.

### 11.3 Permissions Chrome

| Permission | Usage |
|---|---|
| `storage` | Stockage configuration, cache, préférences. |
| `identity` | Obtention d’un token OAuth utilisateur. |

Aucun scope Gmail direct n’est demandé par l’extension.

### 11.4 Host permissions

| Host | Usage |
|---|---|
| `script.google.com/macros/s/*/exec` | Appels vers la Web App utilisateur. |
| `oauth2.googleapis.com/*` | Vérification/authentification OAuth. |
| `www.gstatic.com/generate_204` | Sonde de connectivité réelle utilisée par `isReallyOnline()` (`api.js`). Réponse 204 sans corps, ping court (timeout 4 s) déclenché uniquement en cas d'échec d'un appel API pour distinguer une vraie panne réseau d'une erreur applicative. |

### 11.5 Limites de sécurité

- L’utilisateur doit déployer correctement Apps Script.
- Les permissions Gmail sont accordées au script Apps Script.
- Si l’utilisateur modifie `Code.gs`, le comportement réel peut changer.
- Les conversations supprimées restent restaurables uniquement tant qu’elles sont dans la corbeille Gmail.
- La sécurité dépend aussi du compte Google de l’utilisateur.

### 11.6 Surface d’attaque

Surface principale :

- URL Web App Apps Script ;
- token OAuth ;
- configuration Chrome locale ;
- projet Apps Script utilisateur.

Réductions de risque :

- validation OAuth côté serveur ;
- vérification d’audience ;
- HTTPS ;
- absence de serveur développeur ;
- permissions Chrome limitées ;
- suppression vers corbeille, pas purge définitive.

### 11.7 Choix d’architecture orientés confidentialité

- Pas de base de données développeur.
- Pas de télémétrie annoncée.
- Pas d’analytics.
- Pas de remote logging.
- Règles stockées dans le compte Google de l’utilisateur.
- Extension sans accès direct au contenu Gmail.

---

## 12. Liste complète des fonctionnalités

### 12.1 Popup principal

- affichage des règles existantes ;
- ajout manuel d’expéditeurs ;
- ajout de plusieurs adresses ;
- suppression d’une règle ;
- nettoyage manuel ;
- feedback de progression ;
- messages d’erreur ;
- cache local ;
- redirection vers configuration si nécessaire.

### 12.2 Menu paramètres

- thème auto/clair/sombre ;
- langue FR/EN ;
- ignorer les emails non lus ;
- conserver ou nettoyer les récapitulatifs ;
- définir la durée par défaut via libellé ;
- exporter en CSV ;
- importer depuis CSV ;
- vider la liste.

### 12.3 Page de configuration

- guide Apps Script ;
- affichage du code à copier ;
- bouton de copie ;
- validation de l’URL Web App ;
- sauvegarde de la configuration ;
- aides visuelles.

### 12.4 Backend Apps Script

- authentification OAuth ;
- gestion des règles ;
- gestion des paramètres ;
- recherche Gmail ;
- ingestion via libellé ;
- déplacement vers corbeille ;
- libellé de traçabilité ;
- récapitulatif email ;
- nettoyage des anciens récapitulatifs par marqueur ;
- verrouillage concurrent.

### 12.5 Service worker

- ouverture de la configuration à l’installation ;
- traitement des batchs ;
- retries ;
- stockage d’état ;
- messages de progression.

### 12.6 i18n

- interface FR/EN ;
- sujets de résumé FR/EN ;
- contenu de résumé FR/EN ;
- synchronisation de langue côté Apps Script.

---

## 13. Alignement avec la politique de confidentialité

### 13.1 Modèle de confidentialité

La politique de confidentialité à jour indique que :

- l’extension ne lit pas directement les emails Gmail ;
- l’extension communique avec la Web App Apps Script de l’utilisateur ;
- le nettoyage est exécuté dans l’environnement Google de l’utilisateur ;
- aucune donnée n’est envoyée à un serveur développeur ;
- les règles sont stockées dans `RETENTION_RULES_MAP` ;
- les récapitulatifs utilisent les nouveaux sujets neutres ;
- les anciens récapitulatifs sont nettoyés grâce à un marqueur stable.

### 13.2 Données stockées par l’extension

- URL Web App ;
- langue ;
- thème ;
- caches locaux ;
- état temporaire de batch ;
- compteur local d’échecs réseau.

### 13.3 Données stockées par Apps Script

- règles de rétention ;
- durée par défaut ;
- préférences de nettoyage ;
- langue ;
- destinataire du résumé ;
- compteur total de suppressions.

### 13.4 Données Gmail traitées pendant le nettoyage

Le script peut traiter :

- expéditeur ;
- sujet ;
- date ;
- conversation Gmail ;
- statut lu/non lu via la recherche.

Ces données sont utilisées pour exécuter le nettoyage et générer le récapitulatif.

### 13.5 Comportement du récapitulatif

Le récapitulatif :

- est envoyé au compte de l’utilisateur ;
- utilise un sujet neutre ;
- contient un marqueur technique stable ;
- peut être automatiquement nettoyé aux runs suivants ;
- n’est pas envoyé à un tiers.

Sujets :

```txt
FR: Récapitulatif Autoclean-email
EN: Autoclean-email cleanup summary
```

Marqueur :

```txt
AUTOCLEAN_SUMMARY_EMAIL_v1
```

### 13.6 Garanties de confidentialité reflétées dans l’implémentation

- pas de serveur tiers du développeur ;
- pas de télémétrie mentionnée ;
- OAuth minimal côté extension ;
- données principales dans Apps Script utilisateur ;
- suppression vers corbeille ;
- traçabilité via libellé Gmail.

---

## 14. Notes obsolètes retirées

Les anciennes sections qui signalaient un écart entre la documentation et le code sur :

- le sujet exact des récapitulatifs ;
- l’ancien nom `BLOCKED_SENDERS_MAP` ;
- la détection des anciens récapitulatifs uniquement par sujet ;
- la présence supposée d’un marqueur non utilisé ;
- les incohérences Mermaid non actionnables ;

ont été retirées ou réécrites.

La documentation présente maintenant le comportement attendu à jour, basé sur les changements déclarés.

---

## 15. Limitations techniques, contraintes et compromis

### 15.1 Limites Apps Script

- quotas Google ;
- temps d’exécution limité ;
- verrouillage nécessaire ;
- dépendance au projet déployé par l’utilisateur ;
- nécessité d’une configuration correcte.

### 15.2 Limites Chrome MV3

- service worker interruptible ;
- état à persister explicitement ;
- communication asynchrone ;
- contraintes de permissions.

### 15.3 Compromis CSV

- format simple ;
- séparateur `;` ;
- parsing volontairement limité ;
- adapté à un import/export de règles, pas à un traitement CSV avancé.

### 15.4 Compromis API

- appels séquentiels pour les batchs ;
- retries limités ;
- timeout côté extension ;
- logique simple et robuste plutôt qu’optimisation agressive.

### 15.5 Compromis UX

- popup compact ;
- liste paginée/limitée ;
- configuration Apps Script demandant plusieurs étapes ;
- dépendance à une installation utilisateur un peu technique.

C’est le prix à payer pour éviter de tout envoyer dans un backend propriétaire. L’humanité appelle ça “simplicité”. Puis elle ajoute OAuth, Apps Script, Manifest V3 et des quotas. Admirable.

### 15.6 Compromis sécurité

- pas de serveur développeur, donc moins de centralisation ;
- mais plus de responsabilité côté utilisateur ;
- Apps Script détient les permissions Gmail ;
- la restauration dépend de la corbeille Gmail ;
- un code Apps Script modifié peut changer le comportement réel.

---

# Annexes

## Annexe A — Référence des actions API

| Action | Description |
|---|---|
| `list` | Récupère toutes les règles de rétention. |
| `settings` | Récupère les paramètres globaux. |
| `setSettings` | Met à jour plusieurs paramètres. |
| `labelStatus` | Vérifie l’existence du libellé `Add-sender`. |
| `createLabel` | Crée le libellé `Add-sender`. |
| `setLanguage` | Change la langue. |
| `setDefaultLabelDays` | Change la durée par défaut. |
| `add` | Ajoute ou met à jour une règle. |
| `remove` | Supprime une règle. |
| `clearAll` | Vide les règles. |
| `runCleanup` | Lance un nettoyage Gmail. |
| `setSkipUnread` | Active/désactive la protection des non lus. |
| `setSkipSummaryCleanup` | Active/désactive la conservation des récapitulatifs. |

## Annexe B — Référence des clés `ScriptProperties`

| Clé | Description |
|---|---|
| `RETENTION_RULES_MAP` | Map JSON des règles de rétention. |
| `DEFAULT_LABEL_DAYS` | Durée par défaut pour l’ajout via `Add-sender`. |
| `SKIP_UNREAD` | Ignore les conversations non lues si actif. |
| `SKIP_SUMMARY_CLEANUP` | Conserve les anciens récapitulatifs si actif. |
| `TOTAL_DELETED_EMAILS` | Compteur cumulatif. |
| `LANG` | Langue du résumé. |
| `SUMMARY_RECIPIENT` | Destinataire du résumé. |

## Annexe C — Glossaire des constantes

| Constante / valeur | Rôle |
|---|---|
| `RETENTION_RULES_MAP` | Stockage des règles par expéditeur. |
| `SUMMARY_BODY_MARKER` | Marqueur stable de détection des emails de résumé. |
| `AUTOCLEAN_SUMMARY_EMAIL_v1` | Valeur du marqueur HTML caché. |
| `Récapitulatif Autoclean-email` | Sujet français du résumé. |
| `Autoclean-email cleanup summary` | Sujet anglais du résumé. |
| `Add-sender` | Libellé Gmail d’ajout d’expéditeur. |
| `Suppression-Autoclean` | Libellé Gmail de traçabilité des suppressions. |
| `MAX_SENDERS_PER_QUERY` | Nombre maximal d’expéditeurs par requête Gmail. |
| `MAX_THREADS_TO_DELETE_PER_RUN` | Nombre maximal de conversations déplacées par exécution. |
| `MAX_RETENTION_DAYS` | Durée maximale autorisée. |

---

## Synthèse finale

Autoclean-email est une extension Chrome qui automatise la suppression contrôlée de conversations Gmail à partir de règles de rétention par expéditeur.

Son architecture repose sur une séparation claire :

- l’extension gère l’interface, la configuration, les batchs et l’authentification OAuth minimale ;
- Apps Script, déployé par l’utilisateur, exécute les opérations Gmail ;
- les règles sont stockées dans `RETENTION_RULES_MAP` ;
- les emails de récapitulatif utilisent des sujets neutres ;
- les anciens récapitulatifs sont identifiés par le marqueur stable `AUTOCLEAN_SUMMARY_EMAIL_v1` ;
- aucune infrastructure serveur développeur n’est nécessaire.

La solution reste volontairement simple : définir combien de temps garder les emails d’un expéditeur, puis laisser Apps Script déplacer les conversations éligibles vers la corbeille Gmail.
