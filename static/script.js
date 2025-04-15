// SmartCadenas Dashboard - Client-side logic

document.addEventListener('DOMContentLoaded', function () {
    // Variables globales
    const generateBtn = document.getElementById('generate-btn');
    const timeLeftDisplay = document.getElementById('time-left');
    const resolveBtns = document.querySelectorAll('.resolve-btn');

    // Mise à jour du temps restant
    function updateTimeLeft() {
        const codeElement = document.querySelector('.code-display');
        if (!codeElement) return;

        const validUntilElement = document.querySelector('.badge.bg-info');
        if (!validUntilElement) return;

        // Extraire l'heure de validité
        const timeText = validUntilElement.textContent;
        const timeString = timeText.replace('Valide jusqu\'à ', '').trim();

        // Calculer temps restant
        const now = new Date();
        const [hours, minutes, seconds] = timeString.split(':').map(Number);
        const validUntil = new Date();
        validUntil.setHours(hours, minutes, seconds);

        // Si la date est dépassée (ex: minuit), ajouter un jour
        if (validUntil < now) {
            validUntil.setDate(validUntil.getDate() + 1);
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
    }

    // Génération d'un nouveau code
    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            try {
                generateBtn.disabled = true;
                generateBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Génération...';

                const response = await fetch('/api/code', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    const data = await response.json();

                    // Afficher notification puis rafraîchir
                    const validTime = new Date(data.valid_until).toLocaleTimeString();
                    showNotification(`Nouveau code généré: ${data.code}\nValide jusqu'à ${validTime}`);

                    setTimeout(() => {
                        location.reload();
                    }, 1500);
                } else {
                    const error = await response.json();
                    showNotification('Erreur: ' + (error.error || 'Impossible de générer le code'), 'error');
                    generateBtn.disabled = false;
                    generateBtn.innerHTML = '<i class="bi bi-key-fill me-2"></i>Réessayer';
                }
            } catch (error) {
                console.error('Erreur:', error);
                showNotification('Erreur de connexion au serveur', 'error');
                generateBtn.disabled = false;
                generateBtn.innerHTML = '<i class="bi bi-key-fill me-2"></i>Réessayer';
            }
        });
    }

    // Gestion des boutons pour résoudre les alertes
    resolveBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const alertIndex = btn.dataset.alertIndex;

            try {
                const response = await fetch(`/api/alert/${alertIndex}/resolve`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    // Masquer l'alerte résolue avec animation
                    const alertItem = document.querySelector(`.alert-item[data-alert-index="${alertIndex}"]`);
                    alertItem.style.opacity = '0.5';
                    alertItem.style.height = alertItem.offsetHeight + 'px';

                    setTimeout(() => {
                        alertItem.style.height = '0';
                        alertItem.style.padding = '0';
                        alertItem.style.margin = '0';
                        alertItem.style.overflow = 'hidden';

                        setTimeout(() => {
                            alertItem.remove();

                            // Mettre à jour le compteur d'alertes
                            const alertCounter = document.querySelector('.card-header .badge');
                            if (alertCounter) {
                                const currentCount = parseInt(alertCounter.textContent);
                                alertCounter.textContent = `${currentCount - 1} non résolues`;
                            }

                            // Afficher message si plus d'alertes
                            const alertContainer = document.querySelector('.card-body .list-group');
                            if (alertContainer && alertContainer.children.length === 0) {
                                alertContainer.innerHTML = '<div class="list-group-item text-center text-muted py-3">Aucune alerte active</div>';
                            }
                        }, 300);
                    }, 200);

                } else {
                    showNotification('Erreur lors de la résolution de l\'alerte', 'error');
                }
            } catch (error) {
                console.error('Erreur:', error);
                showNotification('Erreur de connexion au serveur', 'error');
            }
        });
    });

    // Fonction pour afficher une notification
    function showNotification(message, type = 'success') {
        // Créer la notification
        const notification = document.createElement('div');
        notification.className = `toast align-items-center text-white bg-${type === 'success' ? 'success' : 'danger'} position-fixed bottom-0 end-0 m-3`;
        notification.setAttribute('role', 'alert');
        notification.setAttribute('aria-live', 'assertive');
        notification.setAttribute('aria-atomic', 'true');

        notification.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
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

    // Actualiser le temps restant toutes les secondes
    updateTimeLeft();
    setInterval(updateTimeLeft, 1000);

    // Actualiser la page toutes les 60 secondes
    setTimeout(() => {
        document.getElementById('update-time').textContent = new Date().toLocaleTimeString();
    }, 60000);
});