"""
Module de gestion d'API pour l'application SmartCadenas.

Ce module fournit une API Flask pour la gestion des codes d'accès,
des logs de sécurité et des alertes pour un système de cadenas intelligent.
"""

import json
import logging
import os
import re
import secrets
import string
from datetime import datetime, timedelta
from typing import Any, Dict, Tuple, Union

from dotenv import load_dotenv
from flask import Flask, render_template, request
from flask_cors import CORS
from flask_restful import Api, Resource

# Charger les variables d'environnement
load_dotenv()

# Configuration du logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler('app.log'), logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)
app.config['JSON_SORT_KEYS'] = False
app.secret_key = os.getenv('SECRET_KEY', secrets.token_hex(16))
api = Api(app)

# Ajouter les fonctions utiles à l'environnement Jinja2
app.jinja_env.globals.update(max=max, min=min)

# Constantes
DATA_FILE = 'codes.json'
MAX_LOGS = int(os.getenv('MAX_LOGS', 1000))
MAX_ALERTS = int(os.getenv('MAX_ALERTS', 100))
DEFAULT_CODE_LENGTH = 4
DEFAULT_CODE_VALIDITY = 300  # 5 minutes
DEFAULT_MAX_ATTEMPTS = 3


def get_default_data() -> Dict[str, Any]:
    """Retourne la structure de données par défaut.

    Returns:
        Dict[str, Any]: Structure de données initiale
    """
    return {
        "settings": {
            "code_length": int(os.getenv('CODE_LENGTH', DEFAULT_CODE_LENGTH)),
            "code_validity": int(os.getenv('CODE_VALIDITY', DEFAULT_CODE_VALIDITY)),
            "max_attempts": int(os.getenv('MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS))
        },
        "current_code": {},
        "access_logs": [],
        "alerts": [],
        "agents": {
            "default": {
                "name": "Technicien",
                "permissions": ["basic_access"]
            }
        },
        "failed_attempts": {
            "count": 0,
            "last_reset": datetime.now().isoformat(),
            "attempts": []
        }
    }


def sanitize_input(input_str: Union[str, Any]) -> str:
    """Nettoie une entrée utilisateur.

    Args:
        input_str: Chaîne à nettoyer

    Returns:
        str: Chaîne nettoyée ou chaîne vide si invalide
    """
    if not isinstance(input_str, str):
        return ""
    return re.sub(r'[<>\'";`]', '', input_str)


def load_data() -> Dict[str, Any]:
    """Charge les données depuis le fichier JSON.

    Returns:
        Dict[str, Any]: Données chargées
    """
    if not os.path.exists(DATA_FILE):
        default_data = get_default_data()
        with open(DATA_FILE, 'w', encoding='utf-8') as file:
            json.dump(default_data, file, indent=2, ensure_ascii=False)
        return default_data

    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as file:
            data = json.load(file)

        if not isinstance(data, dict):
            logger.error("Format de données invalide, réinitialisation...")
            raise ValueError("Format de données JSON invalide")

        # Initialiser les structures manquantes
        default_data = get_default_data()
        for key, value in default_data.items():
            if key not in data:
                data[key] = value

        return data
    except (json.JSONDecodeError, ValueError) as e:
        logger.error(f"Erreur lors du chargement des données: {str(e)}")
        backup_file = f"{DATA_FILE}.bak.{datetime.now().strftime('%Y%m%d%H%M%S')}"

        try:
            with open(backup_file, 'w', encoding='utf-8') as file:
                json.dump(get_default_data(), file, indent=2, ensure_ascii=False)
            logger.info(f"Sauvegarde créée: {backup_file}")
        except Exception as backup_error:
            logger.error(f"Erreur lors de la création de la sauvegarde: {str(backup_error)}")

        with open(DATA_FILE, 'w', encoding='utf-8') as file:
            json.dump(get_default_data(), file, indent=2, ensure_ascii=False)
        return get_default_data()


def save_data(data: Dict[str, Any]) -> bool:
    """Sauvegarde les données dans le fichier JSON.

    Args:
        data: Données à sauvegarder

    Returns:
        bool: True si sauvegarde réussie
    """
    try:
        # Limiter la taille des logs et alertes
        for collection in ["access_logs", "alerts"]:
            if collection in data and len(data[collection]) > (MAX_LOGS if collection == "access_logs" else MAX_ALERTS):
                data[collection] = sorted(
                    data[collection],
                    key=lambda x: x.get('timestamp', ''),
                    reverse=True
                )[:MAX_LOGS if collection == "access_logs" else MAX_ALERTS]

        with open(DATA_FILE, 'w', encoding='utf-8') as file:
            json.dump(data, file, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"Erreur lors de la sauvegarde des données: {str(e)}")
        return False


def generate_code(length: int = DEFAULT_CODE_LENGTH) -> str:
    """Génère un code numérique aléatoire sécurisé.

    Args:
        length: Longueur du code (4-10)

    Returns:
        str: Code généré
    """
    if not isinstance(length, int) or length < 4 or length > 10:
        length = DEFAULT_CODE_LENGTH
    return ''.join(secrets.choice(string.digits) for _ in range(length))


def is_code_valid(code_data: Dict[str, Any]) -> bool:
    """Vérifie si un code est valide.

    Args:
        code_data: Données du code

    Returns:
        bool: True si le code est valide
    """
    if not code_data or not code_data.get("valid_until"):
        return False

    try:
        valid_until = datetime.fromisoformat(code_data["valid_until"])
        return datetime.now() < valid_until and not code_data.get("used", False)
    except (ValueError, TypeError) as e:
        logger.error(f"Erreur lors de la validation du code: {str(e)}")
        return False


def create_security_alert(
        storage: Dict[str, Any],
        alert_type: str,
        message: str,
        severity: str = "medium") -> Dict[str, Any]:
    """Crée une alerte de sécurité.

    Args:
        storage: Données de stockage
        alert_type: Type d'alerte
        message: Message d'alerte
        severity: Gravité (low/medium/high/critical)

    Returns:
        Dict[str, Any]: Alerte créée
    """
    valid_severities = ["low", "medium", "high", "critical"]
    severity = severity if severity in valid_severities else "medium"

    alert = {
        "type": sanitize_input(alert_type),
        "message": sanitize_input(message),
        "severity": severity,
        "timestamp": datetime.now().isoformat(),
        "resolved": False,
        "_index": len(storage.get("alerts", []))
    }

    storage.setdefault("alerts", []).append(alert)
    return alert


def increment_failed_attempt(storage: Dict[str, Any]) -> int:
    """Incrémente le compteur de tentatives échouées.

    Args:
        storage: Données de stockage

    Returns:
        int: Nombre actuel de tentatives
    """
    if "failed_attempts" not in storage:
        storage["failed_attempts"] = {
            "count": 0,
            "last_reset": datetime.now().isoformat(),
            "attempts": []
        }

    current_time = datetime.now()
    ip_address = request.remote_addr if request else "unknown"
    user_agent = request.headers.get('User-Agent', 'unknown') if request else "unknown"

    storage["failed_attempts"]["count"] += 1
    storage["failed_attempts"]["attempts"].append({
        "timestamp": current_time.isoformat(),
        "ip_address": ip_address,
        "user_agent": user_agent[:200]  # Limiter la taille
    })

    # Nettoyer les tentatives anciennes
    cutoff_time = (current_time - timedelta(minutes=15)).isoformat()
    storage["failed_attempts"]["attempts"] = [
        a for a in storage["failed_attempts"]["attempts"]
        if a["timestamp"] > cutoff_time
    ]
    storage["failed_attempts"]["count"] = len(storage["failed_attempts"]["attempts"])

    # Créer une alerte si le seuil est atteint
    max_attempts = storage.get("settings", {}).get("max_attempts", DEFAULT_MAX_ATTEMPTS)
    if storage["failed_attempts"]["count"] >= max_attempts:
        create_security_alert(
            storage,
            "multiple_failed_attempts",
            f"{storage['failed_attempts']['count']} tentatives échouées depuis {ip_address}",
            "high"
        )
        storage["failed_attempts"] = {
            "count": 0,
            "last_reset": datetime.now().isoformat(),
            "attempts": []
        }

    return storage["failed_attempts"]["count"]


# Filtres de template
@app.template_filter('datetimeformat')
def datetimeformat(value: Union[str, datetime], fmt: str = '%Y-%m-%d %H:%M:%S') -> str:
    """Formate une date pour l'affichage.

    Args:
        value: Date à formater
        fmt: Format de sortie

    Returns:
        str: Date formatée ou chaîne vide
    """
    if not value:
        return ""

    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except (ValueError, TypeError):
            return value

    return value.strftime(fmt)


# Gestion des erreurs
@app.errorhandler(404)
def page_not_found(_) -> Tuple[str, int]:
    """Gère les erreurs 404."""
    return render_template('error.html', error="Page non trouvée", code=404), 404


@app.errorhandler(500)
def server_error(_) -> Tuple[str, int]:
    """Gère les erreurs 500."""
    return render_template('error.html', error="Erreur serveur", code=500), 500


# Routes principales
@app.route('/')
def dashboard() -> Union[str, Tuple[str, int]]:
    """Affiche le tableau de bord principal."""
    try:
        data = load_data()
        settings = data.get("settings", {})

        # Pagination
        logs_page = max(1, request.args.get('logs_page', 1, type=int))
        alerts_page = max(1, request.args.get('alerts_page', 1, type=int))
        per_page = 5

        # Logs
        logs = sorted(data.get("access_logs", []), key=lambda x: x.get('timestamp', ''), reverse=True)
        total_logs = len(logs)
        logs_to_show = logs[(logs_page - 1) * per_page: logs_page * per_page]

        # Alertes
        alerts = [a for a in data.get("alerts", []) if not a.get("resolved", False)]
        alerts = sorted(alerts, key=lambda x: x.get('timestamp', ''), reverse=True)
        total_alerts = len(alerts)
        alerts_to_show = alerts[(alerts_page - 1) * per_page: alerts_page * per_page]

        # Tentatives échouées
        failed_attempts = data.get("failed_attempts", {"count": 0})
        failed_count = failed_attempts.get("count", 0)
        max_attempts = settings.get("max_attempts", DEFAULT_MAX_ATTEMPTS)
        progress = (failed_count / max_attempts) * 100 if max_attempts > 0 else 0

        # Niveau de sécurité
        security_level = "danger" if failed_count >= max_attempts else \
            "warning" if failed_count > 0 else "success"

        # Raisons d'échec
        failure_reasons = {}
        recent_failed_logs = [log for log in logs if log.get("status") == "failed"][:20]
        for log in recent_failed_logs:
            reason = log.get("reason", "unknown")
            failure_reasons[reason] = failure_reasons.get(reason, 0) + 1

        return render_template(
            'dashboard.html',
            now=datetime.now(),
            current_code=data.get("current_code"),
            logs=logs_to_show,
            alerts=alerts_to_show,
            total_logs=total_logs,
            total_alerts=total_alerts,
            logs_page=logs_page,
            logs_pages=max(1, (total_logs + per_page - 1) // per_page),
            alerts_page=alerts_page,
            alerts_pages=max(1, (total_alerts + per_page - 1) // per_page),
            failed_attempts_count=failed_count,
            max_attempts=max_attempts,
            security_level=security_level,
            progress_percentage=progress,
            failure_reasons=failure_reasons
        )
    except Exception as e:
        logger.error(f"Erreur dashboard: {str(e)}")
        return render_template('error.html', error="Erreur dashboard", code=500), 500


class CodeResource(Resource):
    """Gère les opérations sur les codes d'accès."""

    def get(self) -> Dict[str, Any]:
        """Récupère le code actuel."""
        try:
            data = load_data()
            current_code = data.get("current_code", {})

            if not current_code or not current_code.get("value"):
                return {"valid": False, "code": None, "remaining_time": 0, "reason": "no_code_generated"}

            code_valid = is_code_valid(current_code)
            remaining_time = 0
            reason = None

            if code_valid:
                valid_until = datetime.fromisoformat(current_code["valid_until"])
                remaining_time = max(0, int((valid_until - datetime.now()).total_seconds()))
            else:
                reason = "code_expired"

            if current_code.get("used", False):
                code_valid = False
                reason = "code_already_used"

            return {
                "valid": code_valid,
                "code": current_code["value"],
                "remaining_time": remaining_time,
                "reason": reason
            }
        except Exception as e:
            logger.error(f"Erreur GET CodeResource: {str(e)}")
            return {"error": "Erreur serveur"}, 500

    def post(self) -> Tuple[Dict[str, Any], int]:
        """Génère un nouveau code."""
        try:
            data = load_data()
            settings = data.get("settings", {})

            code_length = max(4, min(10, settings.get("code_length", DEFAULT_CODE_LENGTH)))
            code_validity = max(60, settings.get("code_validity", DEFAULT_CODE_VALIDITY))

            new_code = generate_code(code_length)
            generated_at = datetime.now()
            valid_until = generated_at + timedelta(seconds=code_validity)

            data["current_code"] = {
                "value": new_code,
                "generated_at": generated_at.isoformat(),
                "valid_until": valid_until.isoformat(),
                "used": False,
                "used_for_entry": False
            }

            if not save_data(data):
                return {"error": "Erreur sauvegarde"}, 500

            return {
                "code": new_code,
                "generated_at": generated_at.isoformat(),
                "valid_until": valid_until.isoformat()
            }, 201
        except Exception as e:
            logger.error(f"Erreur POST CodeResource: {str(e)}")
            return {"error": "Erreur serveur"}, 500


class AccessResource(Resource):
    """Gère les tentatives d'accès."""

    def post(self) -> Tuple[Dict[str, Any], int]:
        """Enregistre une tentative d'accès."""
        try:
            req_data = request.json
            if not req_data or not isinstance(req_data, dict):
                return {"error": "Données invalides"}, 400

            event = req_data.get('event')
            code = req_data.get('code')
            agent = sanitize_input(req_data.get('agent', 'unknown'))

            if not event or not code:
                return {"error": "Champs manquants"}, 400

            if len(code) > 10:
                return {"error": "Code invalide"}, 400

            if event not in ["door_open", "door_close"]:
                return {"error": "Événement non reconnu"}, 400

            storage = load_data()
            timestamp = datetime.now().isoformat()
            ip_address = request.remote_addr

            log_entry = {
                "event": event,
                "code_used": code,
                "agent": agent,
                "timestamp": timestamp,
                "ip_address": ip_address,
                "status": "pending"
            }

            if event == "door_close":
                self._handle_door_close(storage, code, log_entry)
            else:
                self._handle_door_open(storage, code, log_entry)

            storage.setdefault("access_logs", []).append(log_entry)
            save_data(storage)

            return {
                "status": "logged",
                "event_status": log_entry["status"],
                "reason": log_entry.get("reason")
            }, 201
        except Exception as e:
            logger.error(f"Erreur POST AccessResource: {str(e)}")
            return {"error": "Erreur serveur"}, 500

    def _handle_door_close(self, storage: Dict[str, Any], code: str, log_entry: Dict[str, Any]) -> None:
        """Gère un événement de fermeture de porte."""
        if storage.get("current_code", {}).get("value") == code:
            storage["current_code"]["used"] = True
            log_entry.update({
                "status": "success",
                "reason": "Code invalidé après sortie"
            })
        else:
            log_entry.update({
                "status": "warning",
                "reason": "Code non reconnu pour la sortie"
            })

    def _handle_door_open(self, storage: Dict[str, Any], code: str, log_entry: Dict[str, Any]) -> None:
        """Gère un événement d'ouverture de porte."""
        current_code = storage.get("current_code", {})
        code_valid = is_code_valid(current_code)

        if code_valid and current_code.get("value") == code and not current_code.get("used", False):
            log_entry["status"] = "success"
            storage["current_code"]["used_for_entry"] = True
        else:
            log_entry["status"] = "failed"
            self._set_failure_reason(current_code, code, log_entry)
            increment_failed_attempt(storage)

    def _set_failure_reason(self, code_data: Dict[str, Any], code: str, log_entry: Dict[str, Any]) -> None:
        """Détermine la raison de l'échec."""
        if not code_data or not code_data.get("value"):
            log_entry["reason"] = "no_code_generated"
        elif not is_code_valid(code_data):
            log_entry["reason"] = "code_expired"
        elif code_data.get("value") != code:
            log_entry["reason"] = "code_incorrect"
        elif code_data.get("used", False):
            log_entry["reason"] = "code_already_used"


class LogsResource(Resource):
    """Gère l'accès aux logs."""

    def get(self) -> Dict[str, Any]:
        """Récupère les logs paginés."""
        try:
            data = load_data()
            page = max(1, request.args.get('page', 1, type=int))
            per_page = min(50, max(1, request.args.get('per_page', 10, type=int)))

            logs = sorted(data.get("access_logs", []), key=lambda x: x.get('timestamp', ''), reverse=True)
            total = len(logs)
            start = (page - 1) * per_page

            return {
                "logs": logs[start:start + per_page],
                "pagination": {
                    "total": total,
                    "page": page,
                    "per_page": per_page,
                    "pages": max(1, (total + per_page - 1) // per_page)
                }
            }
        except Exception as e:
            logger.error(f"Erreur GET LogsResource: {str(e)}")
            return {"error": "Erreur serveur"}, 500


class AlertResource(Resource):
    """Gère la création d'alertes."""

    def post(self) -> Tuple[Dict[str, Any], int]:
        """Crée une nouvelle alerte."""
        try:
            req_data = request.json
            if not req_data or not isinstance(req_data, dict):
                return {"error": "Données invalides"}, 400

            alert_type = req_data.get('type')
            message = req_data.get('message')
            severity = req_data.get('severity', 'medium')

            if not alert_type or not message:
                return {"error": "Champs manquants"}, 400

            storage = load_data()
            alert = create_security_alert(storage, alert_type, message, severity)

            if not save_data(storage):
                return {"error": "Erreur sauvegarde"}, 500

            return {
                "status": "alert_created",
                "alert_id": alert.get("_index"),
                "timestamp": alert.get("timestamp")
            }, 201
        except Exception as e:
            logger.error(f"Erreur POST AlertResource: {str(e)}")
            return {"error": "Erreur serveur"}, 500


class AlertResolveResource(Resource):
    """Gère la résolution d'alertes."""

    def post(self, index: int) -> Tuple[Dict[str, Any], int]:
        """Marque une alerte comme résolue."""
        try:
            data = load_data()
            alerts = data.get("alerts", [])

            if not isinstance(index, int) or index < 0 or index >= len(alerts):
                return {"error": "Alerte non trouvée"}, 404

            if alerts[index].get("resolved", False):
                return {"error": "Alerte déjà résolue"}, 400

            alerts[index].update({
                "resolved": True,
                "resolved_at": datetime.now().isoformat(),
                "resolved_by": request.remote_addr
            })

            if not save_data(data):
                return {"error": "Erreur sauvegarde"}, 500

            return {
                "status": "alert_resolved",
                "alert_index": index,
                "resolved_at": alerts[index]["resolved_at"]
            }
        except Exception as e:
            logger.error(f"Erreur POST AlertResolveResource: {str(e)}")
            return {"error": "Erreur serveur"}, 500


class AlertsResource(Resource):
    """Gère l'accès aux alertes."""

    def get(self) -> Dict[str, Any]:
        """Récupère les alertes paginées."""
        try:
            data = load_data()
            page = max(1, request.args.get('page', 1, type=int))
            per_page = min(50, max(1, request.args.get('per_page', 10, type=int)))
            show_resolved = request.args.get('show_resolved', 'false').lower() == 'true'

            alerts = data.get("alerts", [])
            if not show_resolved:
                alerts = [a for a in alerts if not a.get("resolved", False)]

            alerts = sorted(alerts, key=lambda x: x.get('timestamp', ''), reverse=True)
            total = len(alerts)
            start = (page - 1) * per_page

            return {
                "alerts": alerts[start:start + per_page],
                "pagination": {
                    "total": total,
                    "page": page,
                    "per_page": per_page,
                    "pages": max(1, (total + per_page - 1) // per_page)
                }
            }
        except Exception as e:
            logger.error(f"Erreur GET AlertsResource: {str(e)}")
            return {"error": "Erreur serveur"}, 500


# Configuration des routes API
api.add_resource(CodeResource, '/api/code')
api.add_resource(AccessResource, '/api/access')
api.add_resource(LogsResource, '/api/logs')
api.add_resource(AlertResource, '/api/alert')
api.add_resource(AlertResolveResource, '/api/alert/<int:index>/resolve')
api.add_resource(AlertsResource, '/api/alerts')


if __name__ == '__main__':
    api_host = os.getenv('API_HOST', '0.0.0.0')
    api_port = int(os.getenv('API_PORT', 5000))

    # Vérification du fichier de données
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(get_default_data(), f, indent=2, ensure_ascii=False)
        logger.info(f"Fichier {DATA_FILE} créé")

    logger.info(f"Démarrage sur {api_host}:{api_port}")
    app.run(
        host=api_host,
        port=api_port,
        debug=os.getenv('FLASK_ENV') == 'development'
    )
