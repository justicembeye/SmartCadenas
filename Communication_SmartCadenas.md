# Communication entre Arduino Nano ESP32 et le Système SmartCadenas

## 📱 Scénarios de Communication Simplifiés

Imaginez cette communication comme une conversation entre deux personnes - le cadenas (Arduino) et le gardien central (
API):

### Scénario 1: Vérification d'un code d'accès

1. **Le technicien saisit un code sur le cadenas**
2. **Le cadenas demande au gardien**: "Ce code est-il valide?"
    - *"Hé gardien, j'ai le code 4321, est-ce que je dois laisser entrer?"*
3. **Le gardien répond**: "Oui/Non + infos"
    - *"Oui, ce code est valide pour encore 2 minutes"* OU
    - *"Non, ce code est invalide ou expiré"*
4. **Le cadenas agit** en fonction de la réponse
    - Ouvre la porte OU reste fermé et affiche erreur

### Scénario 2: Enregistrement d'un accès

1. **La porte s'ouvre** après un code valide
2. **Le cadenas informe le gardien**: "Quelqu'un vient d'entrer"
    - *"Gardien, la porte vient de s'ouvrir avec le code 4321"*
3. **Le gardien note l'information**: "Entrée enregistrée"
    - *"J'ai noté l'entrée à 14h32 dans mon journal"*

### Scénario 3: Enregistrement d'une sortie

1. **Le technicien appuie sur le bouton de sortie**
2. **Le cadenas informe le gardien**: "Quelqu'un vient de sortir"
    - *"Gardien, le technicien vient de sortir"*
3. **Le gardien note et invalide le code**: "Sortie enregistrée, code désactivé"
    - *"J'ai noté la sortie et invalidé le code 4321"*

### Scénario 4: Alerte de sécurité

1. **Plusieurs mauvais codes sont entrés**
2. **Le cadenas alerte le gardien**: "Tentative de forçage possible!"
    - *"Gardien! Quelqu'un a essayé 3 codes incorrects!"*
3. **Le gardien crée une alerte**: "Alerte enregistrée"
    - *"J'ai créé une alerte de sécurité prioritaire"*

## 🔄 Flux de Communication Technique Simplifié

La communication se fait en HTTP (comme votre navigateur web) sur le réseau WiFi:

### 1. Connexion WiFi

```
[Arduino] --- Connexion WiFi ---> [Réseau local] --- Connexion ---> [Serveur API]
```

- L'Arduino se connecte au même réseau WiFi que le serveur API
- Il obtient une adresse IP (comme un numéro de téléphone)
- Il connaît l'adresse du serveur API (ex: 192.168.1.100:5000)

### 2. Vérification d'un code (GET)

```
[Arduino] --- GET /api/code?code=1234 ---> [API]
[Arduino] <--- {"valid": true, "remaining_time": 145} --- [API]
```

### 3. Enregistrement d'événements (POST)

```
[Arduino] --- POST /api/access {"event": "door_open", "code": "1234"} ---> [API] 
[Arduino] <--- {"status": "logged"} --- [API]
```

### 4. Création d'alertes (POST)

```
[Arduino] --- POST /api/alert {"type": "force_attempt", "message": "3 codes invalides"} ---> [API]
[Arduino] <--- {"status": "alert_created"} --- [API]
```

## 🔌 Détails Techniques Mais Simples

### Comment l'Arduino "parle" HTTP?

1. **Bibliothèque WiFi**

```cpp
WiFi.begin("nom_reseau", "mot_de_passe");
while (WiFi.status() != WL_CONNECTED) { delay(500); }
```

2. **Bibliothèque HTTPClient**

```cpp
HTTPClient http;
http.begin("http://192.168.1.100:5000/api/code");
int httpCode = http.GET();
if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();
}
```

3. **ArduinoJson**

```cpp
DynamicJsonDocument doc(1024);
deserializeJson(doc, response);
bool isValid = doc["valid"];

DynamicJsonDocument requestDoc(1024);
requestDoc["event"] = "door_open";
requestDoc["code"] = "1234";
String requestJson;
serializeJson(requestDoc, requestJson);
```

### Format des échanges

#### Vérification de code (GET /api/code)

```json
{
    "code": "1234",
    "valid": true,
    "remaining_time": 145
}
```

#### Enregistrement d'accès (POST /api/access)

```json
{
    "event": "door_open",
    "code": "1234",
    "agent": "Technicien"
}
```

```json
{
    "status": "logged",
    "event_status": "success"
}
```

#### Alerte (POST /api/alert)

```json
{
    "type": "force_attempt",
    "message": "3 tentatives échouées",
    "severity": "high"
}
```

## 🛡️ Comment ça marche concrètement?

### 1. Séquence complète pour une entrée réussie

1. Saisie de code "1234" via télécommande IR
2. Arduino → GET /api/code → API
3. Arduino ← {"valid": true, ...} ← API
4. Arduino active le servo et affiche "Accès autorisé"
5. Arduino → POST /api/access (door_open) → API

### 2. Séquence pour une sortie

1. L'utilisateur appuie sur le bouton intérieur
2. Arduino active le servo
3. Arduino → POST /api/access (door_close) → API

## 🌐 En résumé

- **GET** = Arduino pose une question
- **POST** = Arduino envoie un rapport
- **JSON** = format des messages
- **WiFi** = moyen de transport des messages

L'Arduino est l’agent terrain, l'API est le centre de contrôle.