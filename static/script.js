/**
 * script.js - Fonctions JavaScript pour SmartCadenas
 * Gère le rafraîchissement des données, les interactions utilisateur et les animations
 */

// Constantes et configuration
const REFRESH_INTERVAL = 10000; // Intervalle de rafraîchissement en ms
const API_TIMEOUT = 5000; // Timeout pour les requêtes API en ms
const MAX_RETRIES = 3; // Nombre maximal de tentatives en cas d'échec

// État global
let refreshTimer = null;
let isRefreshing = false;
let currentCode = null;
let connectionProblem = false;
let refreshCount = 0;
let lastRefreshTime = Date.now();

// Fonction au chargement de la page
document.addEventListener('DOMContentLoaded', function () {
    // Initialiser les gestionnaires d'événements
    setupEventHandlers();

    // Démarrer le compte à rebours si un code est actif
    updateRemainingTime();

    // Démarrer le rafraîchissement automatique
    startAutoRefresh();

    // Log dans la console pour aider au débogage
    console.log("SmartCadenas Dashboard initialisé");
});

/**
 * Initialise tous les gestionnaires d'événements
 */
function setupEventHandlers() {
    // Bouton de rafraîchissement manuel
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', manualRefresh);
    }

    // Bouton de génération de code
    const generateBtn = document.getElementById('generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateNewCode);
    }

    // Boutons de résolution d'alertes
    const resolveBtns = document.querySelectorAll('.resolve-btn');
    if (resolveBtns.length > 0) {
        setupResolveButtons(resolveBtns);
    }
}

/**
 * Rafraîchissement manuel avec animation et protection anti-spam
 */
function manualRefresh() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (!refreshBtn) return;

    // Protection contre les clics rapides
    const now = Date.now();
    if (now - lastRefreshTime < 2000) {
        showNotification('Merci de patienter avant de rafraîchir à nouveau', 'warning');
        return;
    }

    lastRefreshTime = now;

    // Effet visuel
    refreshBtn.classList.add('rotating');
    refreshBtn.disabled = true;

    // Mettre à jour l'heure affichée
    updateLastRefreshTime();

    // Rafraîchir la page après un court délai
    setTimeout(() => {
        location.reload();
    }, 500);
}

/**
 * Génère un nouveau code d'accès via l'API
 */
async function generateNewCode() {
    const generateBtn = document.getElementById('generate-btn');
    if (!generateBtn) return;

    try {
        // Désactiver le bouton pour éviter les clics multiples
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Génération...';

        // Délai pour éviter les clics trop rapides
        await new Promise(resolve => setTimeout(resolve, 300));

        const response = await fetch('/api/code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin',
            timeout: API_TIMEOUT
        });

        if (response.ok) {
            const data = await response.json();

            // Vérifier les données reçues
            if (!data.code) {
                throw new Error('Réponse invalide du serveur');
            }

            // Afficher notification
            const validTime = new Date(data.valid_until).toLocaleTimeString();
            showNotification(`Nouveau code généré: ${sanitizeHTML(data.code)}\nValide jusqu'à ${sanitizeHTML(validTime)}`);

            // Rafraîchir après un délai
            setTimeout(() => {
                location.reload();
            }, 1500);
        } else {
            // Gérer les erreurs
            let errorMsg = 'Impossible de générer le code';
            try {
                const error = await response.json();
                errorMsg = error.error || errorMsg;
            } catch (e) {
                console.error('Erreur lors de la lecture de la réponse:', e);
            }

            showNotification('Erreur: ' + errorMsg, 'error');
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="bi bi-key-fill me-2"></i>Réessayer';
        }
    } catch (error) {
        console.error('Erreur:', error);
        showNotification('Erreur de connexion au serveur', 'error');
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i class="bi bi-key-fill me-2"></i>Réessayer';
    }
}

/**
 * Fonction helper pour les requêtes avec réessai automatique
 */
async function fetchWithRetry(url, options, retries = 3) {
    try {
        const response = await fetch(url, {
            ...options,
            timeout: API_TIMEOUT
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response;
    } catch (error) {
        if (retries <= 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
        return fetchWithRetry(url, options, retries - 1);
    }
}

/**
 * Configure les boutons de résolution d'alertes - Version améliorée
 */
function setupResolveButtons(buttons) {
    const resolveInProgress = new Set();

    buttons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const alertIndex = btn.dataset.alertIndex;
            const alertItem = btn.closest('.alert-entry');

            if (!alertItem || resolveInProgress.has(alertIndex)) return;

            resolveInProgress.add(alertIndex);
            btn.disabled = true;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

            try {
                const response = await fetch(`/api/alert/${alertIndex}/resolve`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    credentials: 'same-origin'
                });

                if (response.ok) {
                    // Animation de disparition
                    alertItem.style.transition = 'all 0.3s ease';
                    alertItem.style.opacity = '0';
                    alertItem.style.height = `${alertItem.offsetHeight}px`;

                    setTimeout(() => {
                        alertItem.style.height = '0';
                        alertItem.style.margin = '0';
                        alertItem.style.padding = '0';
                        alertItem.style.border = 'none';

                        setTimeout(() => {
                            alertItem.remove();
                            updateAlertCounter();
                            checkEmptyAlerts();
                        }, 300);
                    }, 200);
                } else {
                    const error = await response.json();
                    throw new Error(error.message || 'Échec de la résolution');
                }
            } catch (error) {
                console.error('Erreur:', error);
                showNotification(error.message || 'Erreur lors de la résolution', 'error');
                btn.innerHTML = originalHtml;
            } finally {
                btn.disabled = false;
                resolveInProgress.delete(alertIndex);
            }
        });
    });
}

/**
 * Helper: Animation de suppression d'alerte
 */
function animateAlertRemoval(alertItem, container) {
    alertItem.style.height = `${alertItem.offsetHeight}px`;
    alertItem.style.opacity = '1';

    requestAnimationFrame(() => {
        alertItem.style.transition = 'all 0.3s ease';
        alertItem.style.opacity = '0';
        alertItem.style.height = '0';
        alertItem.style.margin = '0';
        alertItem.style.padding = '0';
        alertItem.style.border = 'none';

        setTimeout(() => {
            alertItem.remove();
            updateAlertCounter();
            checkEmptyAlerts();
            adjustContainerHeight(container);
        }, 300);
    });
}

/**
 * Helper: Ajuste la hauteur du conteneur après suppression
 */
function adjustContainerHeight(container) {
    requestAnimationFrame(() => {
        container.style.height = 'auto';
    });
}

/**
 * Helper: Réinitialise le bouton après erreur
 */
function resetButton(btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-lg"></i>';
}

/**
 * Anime la suppression d'une alerte résolue
 */
function animateAlertResolution(alertIndex) {
    const alertItem = document.querySelector(`.alert-item[data-alert-index="${alertIndex}"]`);
    if (!alertItem) return;

    // Animation en deux temps
    alertItem.style.opacity = '0.5';
    alertItem.style.height = alertItem.offsetHeight + 'px';

    setTimeout(() => {
        alertItem.style.height = '0';
        alertItem.style.padding = '0';
        alertItem.style.margin = '0';
        alertItem.style.overflow = 'hidden';

        setTimeout(() => {
            alertItem.remove();

            // Mise à jour du compteur d'alertes
            updateAlertCounter();

            // Afficher message si plus d'alertes
            checkEmptyAlerts();
        }, 300);
    }, 200);
}

/**
 * Met à jour le compteur d'alertes
 */
function updateAlertCounter() {
    const alertCounter = document.getElementById('alerts-counter');
    if (!alertCounter) return;

    const remainingAlerts = document.querySelectorAll('.alert-item').length;
    alertCounter.textContent = `${remainingAlerts} non résolue${remainingAlerts !== 1 ? 's' : ''}`;
}

/**
 * Vérifie s'il reste des alertes
 */
function checkEmptyAlerts() {
    const alertContainer = document.getElementById('alerts-container');
    if (!alertContainer) return;

    if (alertContainer.querySelectorAll('.alert-item').length === 0) {
        alertContainer.innerHTML = '<div class="list-group-item text-center text-muted py-3">Aucune alerte active</div>';
    }
}

/**
 * Protection contre les attaques XSS
 */
function sanitizeHTML(str) {
    if (!str) return '';
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

/**
 * Affiche une notification avec animation
 */
function showNotification(message, type = 'success') {
    // Nettoyer le message pour éviter les injections XSS
    message = sanitizeHTML(message);

    // Créer la notification
    const notification = document.createElement('div');
    notification.className = `toast align-items-center text-white bg-${type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'danger'} position-fixed bottom-0 end-0 m-3`;
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', 'assertive');
    notification.setAttribute('aria-atomic', 'true');

    notification.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                ${message.replace(/\n/g, '<br>')}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;

    document.body.appendChild(notification);

    // Afficher puis supprimer après 3 secondes
    setTimeout(() => {
        notification.classList.add('show');
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 500);
        }, 3000);
    }, 100);
}

/**
 * Met à jour le temps restant pour le code actuel
 */
function updateRemainingTime() {
    const timeLeftDisplay = document.getElementById('time-left');
    if (!timeLeftDisplay) return;

    const codeElement = document.querySelector('.code-display');
    if (!codeElement) return;

    const validUntilElement = document.querySelector('.badge.bg-info');
    if (!validUntilElement) return;

    try {
        // Extraire l'heure de validité
        const timeText = validUntilElement.textContent;
        const timeString = timeText.replace('Valide jusqu\'à ', '').trim();

        // Vérifier le format de date
        let validUntil;
        const now = new Date();

        if (timeString.includes('-')) {
            // Format date complète (YYYY-MM-DD HH:MM:SS)
            validUntil = new Date(timeString);
            if (isNaN(validUntil.getTime())) {
                throw new Error('Format de date invalide');
            }
        } else {
            // Format heure seulement (HH:MM:SS) - utiliser la date du jour
            const [hours, minutes, seconds] = timeString.split(':').map(Number);
            if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
                throw new Error('Format d\'heure invalide');
            }

            validUntil = new Date();
            validUntil.setHours(hours, minutes, seconds);

            // Si la date est déjà dépassée, le code a expiré
            if (validUntil < now) {
                timeLeftDisplay.textContent = 'Expiré';
                timeLeftDisplay.className = 'badge bg-danger';
                return;
            }
        }

        const diffInSeconds = Math.floor((validUntil - now) / 1000);

        // Affichage du temps restant
        if (diffInSeconds <= 0) {
            timeLeftDisplay.textContent = 'Expiré';
            timeLeftDisplay.className = 'badge bg-danger';
        } else {
            const mins = Math.floor(diffInSeconds / 60);
            const secs = diffInSeconds % 60;
            timeLeftDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')} restants`;
            timeLeftDisplay.className = 'badge bg-light text-dark';

            // Alerte si moins de 60 secondes
            if (diffInSeconds < 60) {
                timeLeftDisplay.className = 'badge bg-warning text-dark';
            }
        }
    } catch (error) {
        console.error('Erreur dans updateRemainingTime:', error);
        timeLeftDisplay.textContent = 'Format invalide';
        timeLeftDisplay.className = 'badge bg-secondary';
    }
}

/**
 * Met à jour l'heure de dernier rafraîchissement
 */
function updateLastRefreshTime() {
    const updateTimeElement = document.getElementById('update-time');
    if (updateTimeElement) {
        updateTimeElement.textContent = new Date().toLocaleTimeString();
    }
}

/**
 * Démarre le rafraîchissement automatique de la page
 */
function startAutoRefresh() {
    // Mettre à jour le temps restant toutes les secondes
    setInterval(updateRemainingTime, 1000);

    // Rafraîchir la page automatiquement
    refreshTimer = setInterval(() => {
        const codeDisplay = document.querySelector('.code-display');
        // Ne rafraîchir que si un code est affiché
        if (codeDisplay) {
            refreshCount++;
            if (refreshCount >= 3) { // Rafraîchir toutes les 3 périodes
                location.reload();
                refreshCount = 0;
            }
        }
    }, REFRESH_INTERVAL);

    // Mettre à jour l'heure dans le header toutes les 60 secondes
    setInterval(updateLastRefreshTime, 60000);

    // Vérifier périodiquement l'état de l'API
    checkApiStatus();
    setInterval(checkApiStatus, 30000);
}

/**
 * Vérifie l'état de l'API
 */
let apiFailCount = 0;

function checkApiStatus() {
    fetch('/api/code', {
        method: 'GET',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
        timeout: API_TIMEOUT
    })
        .then(response => {
            if (response.ok) {
                apiFailCount = 0; // Réinitialiser en cas de succès

                // Si une connexion était perdue, informer qu'elle est rétablie
                if (connectionProblem) {
                    showNotification('Connexion au serveur rétablie', 'success');
                    connectionProblem = false;
                }
            } else {
                apiFailCount++;
                handleApiFailure();
            }
        })
        .catch(error => {
            apiFailCount++;
            handleApiFailure();
        });
}

/**
 * Gère les échecs de communication avec l'API
 */
function handleApiFailure() {
    if (apiFailCount >= 3 && !connectionProblem) {
        showNotification('Problème de connexion avec le serveur. Essayez de rafraîchir la page.', 'error');
        connectionProblem = true;
    }
}

// Ajouter styles pour l'animation de rotation
(function addRotationStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes rotating {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .rotating {
            animation: rotating 1s linear infinite;
        }
    `;
    document.head.appendChild(style);
})();