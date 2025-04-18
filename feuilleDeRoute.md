

# 🔐 Projet : **SmartCadenas — Serrure Intelligente Sécurisée pour Sites Techniques Isolés**

---

## 🎯 Objectif du projet

> Concevoir un système de verrouillage intelligent et connecté, combinant **logique matérielle**, **microcontrôleur** et **API web**.  
> Le système doit permettre :
- Une saisie de code via télécommande IR  
- Un affichage clair sur LCD  
- Un déverrouillage via servo  
- Un enregistrement des accès/sorties dans une base distante  
- Une gestion des erreurs et des alertes  
- Une sortie manuelle simple et sécurisée  

---

## 🧩 Fonctionnalités principales

| Fonction              | Description                                                         |
|-----------------------|---------------------------------------------------------------------|
| 🔐 Saisie de code IR  | Saisie du code avec une télécommande infrarouge                     |
| ⚙️ Logique circuitale | Circuit logique combinatoire/séquentiel traite les signaux binaires |
| 🧠 Microcontrôleur    | Gère la logique réseau, le WiFi, le traitement logiciel             |
| 🖥️ Affichage LCD     | Affiche code, erreurs, état de la serrure, alertes                  |
| 📡 Connexion API      | Envoie et récupère des données via une API Flask                    |
| 🔓 Déverrouillage     | Commande un servo si le code est correct                            |
| 🔘 Bouton intérieur   | Permet de sortir sans saisir un nouveau code                        |
| 🧲 Détection physique | Deux micro-interrupteurs détectent ouverture et fermeture           |
| 📜 Journalisation     | Heure d’entrée/sortie envoyée à l’API                               |
| 🚨 Sécurité           | Alerte après 3 erreurs, log tentative de forçage                    |

---

## 📌 Cas d’usage (scénarios détaillés)

### 🎮 1. **Entrée via télécommande IR**
- L’agent appuie sur des touches de la télécommande IR.
- Arduino décode chaque touche et la convertit en **code binaire 4 bits**.
- Le **circuit logique** stocke et affiche les chiffres en temps réel.
- Une fois les **4 chiffres saisis**, le circuit envoie un signal `VALID_CODE_READY` à l’Arduino.

### 🔐 2. **Validation du code**
- Arduino récupère le code complet.
- Il envoie une requête HTTP à `API /api/code` → vérifie la validité.
- Si valide :
  - Servo s’ouvre
  - LCD affiche “✅ Accès autorisé”
  - Arduino envoie `/api/access` avec `"event": "door_open"`
- Si invalide:
  - LCD affiche “⛔ Code invalide”
  - En cas de 3 erreurs → `/api/alert` est déclenchée (alerte de sécurité)
  - Buzzer + LED rouge activés

### 🚪 3. **Ouverture de la porte**
- Lorsque la porte est ouverte (micro-interrupteur 1 activé), un message LCD s’affiche : “🚪 Porte ouverte”.
- L’accès est enregistré comme **entrée confirmée**.

### 🔁 4. **Fermeture de la porte**
- Lorsque la porte se referme (micro-interrupteur 2 activé), rien n'est encore envoyé.
- L’agent est désormais dans le site sécurisé.

### 🔘 5. **Sortie via bouton intérieur**
- L’agent appuie sur un **bouton physique** situé à l’intérieur.
- Arduino :
  - Affiche “🔓 Ouverture pour sortie”
  - Active le servo pour déverrouiller la porte
  - Envoie une requête `/api/access` avec `"event": "door_close"`  
  - LCD affiche “📤 Sortie enregistrée”

### 🔔 6. **Tentative échouée / Forçage**
- Si un **mauvais code** est saisi :
  - LCD affiche une erreur
  - LED clignote / buzzer émet un bip
  - Si 3 erreurs → alerte envoyée : `/api/alert`, type `failed_attempt` ou `force_attempt`

---

## 🔧 Matériel nécessaire

| Composant                        | Rôle                                 |
|----------------------------------|--------------------------------------|
| Arduino UNO R4 WiFi / GIGA       | Traitement central + WiFi            |
| Télécommande IR + Récepteur      | Entrée utilisateur                   |
| Latchs / Registres               | Stockage temporaire des bits du code |
| Circuit logique combinatoire     | Décodage et gestion affichage        |
| Afficheur LCD (16x2 ou 20x4)     | Retour utilisateur                   |
| Servo moteur                     | Action de la serrure                 |
| 2 Micro-interrupteurs            | Détection ouverture / fermeture      |
| Bouton poussoir                  | Déclencheur de sortie                |
| Buzzer + LED rouge               | Signalisation des erreurs            |
| Breadboard, résistances, câblage | Montage général                      |

---

## 🧠 Architecture système

```mermaid
flowchart TD
IR[📡 Télécommande IR] --> Arduino[🧠 Arduino R4 WiFi]
Arduino -->|binaire 4 bits| LATCH[⚙️ Latch logique]
LATCH --> LCD[📺 LCD (via logique)]
LATCH -->|signal READY| Arduino
Arduino -->|GET /api/code| API[🌐 API Flask]
API --> Arduino
Arduino -->|Servo ON| LOCK[🔓 Servo serrure]

SW1[🧲 Interrupteur Ouverture] --> Arduino
SW2[🧲 Interrupteur Fermeture] --> Arduino
Button[🔘 Bouton de sortie] --> Arduino
Arduino -->|POST /api/access| API
Arduino -->|event: alert| API
```

---

## 🌐 Côté API Flask (déjà réalisé)

| Endpoint      | Méthode | Utilité                                |
|---------------|---------|----------------------------------------|
| `/api/code`   | `POST`  | Générer un code OTP                    |
| `/api/code`   | `GET`   | Récupérer le code actuel               |
| `/api/access` | `POST`  | Enregistrer `door_open` / `door_close` |
| `/api/alert`  | `POST`  | Créer une alerte (ex: forçage)         |

---

## 📋 Étapes concrètes de réalisation

### Phase 1 – Partie logicielle
- [x] Définir structure API avec Flask
- [x] Créer `/api/code`, `/api/access`, `/api/alert`
- [x] Générer un code aléatoire, journaliser les accès
- [x] Interface HTML dashboard + test avec `curl`
- [x] Tester les scénarios avec `test_api.py`

### Phase 2 – Partie microcontrôleur
- [ ] Lire les touches IR → convertir en 4 bits
- [ ] Afficher le code saisi via circuit logique
- [ ] Envoyer signal `READY` à Arduino
- [ ] Arduino fait requête `/api/code`
- [ ] Gestion du servo selon réponse API
- [ ] Déclencher `/api/access` (`door_open`)
- [ ] Détection par micro-interrupteurs
- [ ] Déclencher `/api/access` (`door_close`) lors de la sortie
- [ ] Affichage dynamique sur LCD
- [ ] Gestion bouton intérieur

### Phase 3 – Circuit logique
- [ ] Réaliser le décodeur 4 bits + latch
- [ ] Affichage dynamique via logique (ou via LCD)
- [ ] Signal logique vers Arduino
- [ ] Buzzer / LED en cas d’alerte

---

## 🧪 Tests recommandés

| Test                         | Résultat attendu                                   |
|------------------------------|----------------------------------------------------|
| Entrée de 4 chiffres via IR  | LCD affiche le code, signal READY                  |
| Code valide                  | Servo s’ouvre, entrée enregistrée                  |
| Code invalide                | LCD erreur, buzzer sonne                           |
| 3 erreurs                    | Alarme déclenchée, `/api/alert` appelé             |
| Sortie avec bouton           | Servo s’ouvre, `/api/access` (`door_close`) envoyé |
| Ouverture/fermeture détectée | Affichage sur LCD, log envoyé                      |

---

## 📦 Organisation des fichiers

| Dossier     | Contenu                                |
|-------------|----------------------------------------|
| `firmware/` | Code Arduino principal + modules       |
| `api/`      | Fichiers Flask + dashboard HTML        |
| `hardware/` | Schémas électroniques + logique        |
| `rapport/`  | Diapos, captures, rapport PDF          |
| `tests/`    | Scripts Python de test (`test_api.py`) |

---

## 🎁 Résultat attendu

✔️ Système **autonome**, sécurisé, connecté  
✔️ Code à usage unique pour entrée  
✔️ Sortie simple via bouton  
✔️ Journalisation complète (entrée/sortie/alerte)  
✔️ Interface de contrôle web  
✔️ Circuit logique intégré pour affichage et traitement partiel

---