"""
API principale pour le système SmartCadenas

Fonctionnalités clés :
 Génération de codes OTP à usage unique
- Invalidation automatique après fermeture de la serrure
- Journalisation complète des accès
- Gestion des alertes de sécurité
"""

import json
import os
import random
from datetime import datetime, timedelta

from dotenv import load_dotenv
from flask import Flask, request, render_template
from flask_restful import Api, Resource

# Initialisation
load_dotenv()
app = Flask(__name__)
api = Api(app)

# Configuration
DATA_FILE = 'codes.json'
# Configuration
CODE_LENGTH = int(os.getenv("CODE_LENGTH", "4").strip())  # 4 chiffres par défaut
MAX_ATTEMPTS = int(os.getenv("MAX_ATTEMPTS", "3").strip())  # 3 tentatives max
CODE_VALIDITY = int(os.getenv("CODE_VALIDITY", "300").strip())  # 5 minutes par défaut


def load_data():
    """Charge les données depuis le fichier JSON avec structure de secours"""
    try:
        with open(DATA_FILE, 'r') as f:
            data = json.load(f)

            # Migration vers le nouveau format si nécessaire
            if 'settings' not in data:
                data['settings'] = {
                    'code_length': CODE_LENGTH,
                    'code_validity': int(os.getenv("CODE_VALIDITY", 300)),
                    'max_attempts': MAX_ATTEMPTS
                }
            return data

    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "settings": {
                "code_length": CODE_LENGTH,
                "code_validity": int(os.getenv("CODE_VALIDITY", 300)),
                "max_attempts": MAX_ATTEMPTS
            },
            "current_code": None,
            "access_logs": [],
            "alerts": [],
            "agents": {
                "default": {
                    "name": "Technicien",
                    "permissions": ["basic_access"]
                }
            }
        }


def save_data(data):
    """Sauvegarde les données avec indentation pour lisibilité"""
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


class CodeResource(Resource):
    """Gestion du cycle de vie des codes d'accès"""

    def get(self):
        """
        Endpoint pour Arduino :
        - Vérifie la validité du code (non utilisé et dans la période de validité)
        - Retourne le code actuel ou null si invalide
        """
        data = load_data()
        current_code = data.get("current_code", {})

        # Vérifier si le code existe et s'il est valide
        is_valid = (
                current_code and
                not current_code.get("used", True) and
                datetime.now() < datetime.fromisoformat(current_code.get("valid_until", "1970-01-01"))
        )

        return {
            "code": current_code.get("value") if is_valid else None,
            "valid": is_valid,
            "remaining_time": self._get_remaining_time(current_code)
        }, 200

    def post(self):
        """Génère un nouveau code OTP avec période de validité"""
        data = load_data()

        # Génération du code
        new_code = ''.join(str(random.randint(0, 9)) for _ in range(data['settings']['code_length']))

        # Calcul de la validité
        validity = data['settings']['code_validity']
        generated_at = datetime.now()
        valid_until = generated_at + timedelta(seconds=validity)

        # Mise à jour des données
        data["current_code"] = {
            "value": new_code,
            "generated_at": generated_at.isoformat(),
            "valid_until": valid_until.isoformat(),
            "used": False,
            "used_for_entry": False  # Indique si le code a été utilisé pour entrer
        }

        save_data(data)
        return {
            "code": new_code,
            "valid_until": valid_until.isoformat()
        }, 201

    def _get_remaining_time(self, code_data):
        """Calcule le temps restant avant expiration en secondes"""
        if not code_data or not code_data.get("valid_until"):
            return 0

        try:
            remaining = datetime.fromisoformat(code_data["valid_until"]) - datetime.now()
            return max(0, int(remaining.total_seconds()))
        except (ValueError, TypeError):
            return 0


class AccessResource(Resource):
    """Gestion des événements d'accès et d'invalidation"""

    def post(self):
        """
        Journalise les événements et gère l'invalidation du code :
        - door_open : première utilisation du code
        - door_close : invalidation définitive
        """
        req_data = request.get_json()
        if not req_data or "event" not in req_data:
            return {"error": "Event type required"}, 400

        data = load_data()
        current_code = data.get("current_code", {})

        # Vérification du code pour les ouvertures
        status = "success"
        if req_data["event"] == "door_open":
            if not self._verify_code(req_data.get("code"), data):
                status = "failed"

                # Compter les tentatives échouées récentes (dernières 5 minutes)
                recent_failures = [
                    log for log in data["access_logs"]
                    if (log["event"] == "door_open" and
                        log["status"] == "failed" and
                        datetime.fromisoformat(log["timestamp"]) > datetime.now() - timedelta(minutes=5))
                ]

                # Créer une alerte si trop de tentatives échouées
                if len(recent_failures) + 1 >= data["settings"]["max_attempts"]:
                    alert_payload = {
                        "type": "force_attempt",
                        "message": f"{len(recent_failures) + 1} tentatives échouées",
                        "severity": "high",
                        "from_request": False
                    }
                    AlertResource().post(alert_payload)

        # Création du log
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "event": req_data["event"],
            "code_used": req_data.get("code"),
            "status": status,
            "agent": req_data.get("agent", "unknown")
        }

        data["access_logs"].append(log_entry)

        # Gestion de l'état du code
        if current_code:
            # Marquer comme utilisé après ouverture réussie
            if req_data["event"] == "door_open" and status == "success":
                data["current_code"]["used_for_entry"] = True

            # Invalidation définitive après fermeture
            elif req_data["event"] == "door_close" and current_code.get("used_for_entry"):
                data["current_code"]["used"] = True

        save_data(data)

        # Envoyer une alerte si tentative échouée
        if status == "failed":
            alert_payload = {
                "type": "failed_attempt",
                "message": f"Tentative échouée avec le code {req_data.get('code')}",
                "from_request": False
            }
            AlertResource().post(alert_payload=alert_payload, existing_data=data)

        return {"status": "logged", "event_status": status}, 201

    def _verify_code(self, code, data):
        """Vérifie la validité du code selon les règles métier"""
        current_code = data.get("current_code")
        if not current_code or not code:
            return False

        return (
                current_code["value"] == code and
                not current_code["used"] and
                datetime.now() < datetime.fromisoformat(current_code["valid_until"])
        )


class AlertResource(Resource):
    """Gestion des alertes de sécurité"""

    def post(self, alert_data=None, existing_data=None):
        """Enregistre une alerte (version modifiée)"""
        # Si appelé depuis une autre classe, utilisé existing_data
        data = existing_data if existing_data else load_data()

        if alert_data is None:
            alert_data = request.get_json()
            if not alert_data or "type" not in alert_data:
                return {"error": "Alert type required"}, 400

        alert_entry = {
            "timestamp": datetime.now().isoformat(),
            "type": alert_data["type"],
            "message": alert_data.get("message", ""),
            "resolved": False,
            "severity": alert_data.get("severity", "medium")
        }

        data["alerts"].append(alert_entry)

        # Ne sauvegarder que si appelé via HTTP
        if existing_data is None:
            save_data(data)

        return {"status": "alert_created"}, 201


@app.route('/api/logs')
def get_logs():
    """Récupère les logs avec pagination"""
    data = load_data()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    # Trier les logs par date (plus récent en premier)
    sorted_logs = sorted(data.get("access_logs", []),
                         key=lambda x: x.get('timestamp', ''),
                         reverse=True)

    # Calculer la pagination
    total = len(sorted_logs)
    start = (page - 1) * per_page
    end = min(start + per_page, total)

    return {
        "logs": sorted_logs[start:end],
        "pagination": {
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page
        }
    }, 200


@app.route('/api/alerts')
def get_alerts():
    """Récupère les alertes avec pagination"""
    data = load_data()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    show_resolved = request.args.get('show_resolved', 'false').lower() == 'true'

    # Filtrer les alertes en fonction du paramètre show_resolved
    alerts = data.get("alerts", [])
    if not show_resolved:
        alerts = [a for a in alerts if not a.get("resolved", False)]

    # Trier les alertes par date (plus récent en premier)
    sorted_alerts = sorted(alerts, key=lambda x: x.get('timestamp', ''), reverse=True)

    # Calculer la pagination
    total = len(sorted_alerts)
    start = (page - 1) * per_page
    end = min(start + per_page, total)

    return {
        "alerts": sorted_alerts[start:end],
        "pagination": {
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page
        }
    }, 200


# Enregistrement des endpoints
api.add_resource(CodeResource, '/api/code')
api.add_resource(AccessResource, '/api/access')
api.add_resource(AlertResource, '/api/alert')


# Filtre personnalisé pour les templates
@app.template_filter('datetimeformat')
def datetimeformat(value, format='%Y-%m-%d %H:%M:%S'):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return value
    return value.strftime(format)


# Route du dashboard
@app.route('/')
def dashboard():
    data = load_data()

    # Gestion des logs
    logs = data.get("access_logs", [])
    try:
        sorted_logs = sorted(logs, key=lambda x: x.get('timestamp', ''), reverse=True)[:50]
    except Exception as e:
        print(f"Erreur de tri des logs: {e}")
        sorted_logs = logs[:50]

    # Filtrage des alertes non résolues
    alerts = [a for a in data.get("alerts", []) if not a.get("resolved", False)][:10]

    return render_template('index.html',
                           current_code=data.get("current_code"),
                           logs=sorted_logs,
                           alerts=alerts,
                           now=datetime.now())  # Ajout de la variable now


# Route pour marquer une alerte comme résolue
@app.route('/api/alert/<int:alert_index>/resolve', methods=['POST'])
def resolve_alert(alert_index):
    data = load_data()

    if 0 <= alert_index < len(data["alerts"]):
        data["alerts"][alert_index]["resolved"] = True
        save_data(data)
        return {"status": "alert_resolved"}, 200

    return {"error": "Alert not found"}, 404


if __name__ == '__main__':
    port = int(os.getenv("API_PORT", 5000))
    app.run(host=os.getenv("API_HOST", "0.0.0.0"), port=port, debug=True)
