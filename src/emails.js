// Module d'envoi d'emails — appelle la fonction serverless /api/envoyer-email
// qui elle-même contacte Resend de façon sécurisée.

async function envoyerEmail(destinataire, sujet, html) {
  try {
    const reponse = await fetch('/api/envoyer-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinataire, sujet, html }),
    });
    if (!reponse.ok) {
      const err = await reponse.json().catch(() => ({}));
      console.error('Erreur envoi email:', err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Erreur réseau envoi email:', e);
    return false;
  }
}

// ─── Templates ──────────────────────────────────────────────────────────────
function enveloppe(contenu) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #F7F0E6; padding: 24px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="font-size: 32px;">🏊</div>
        <div style="font-size: 20px; font-weight: 700; color: #0B6E8A; margin-top: 4px;">Ma Piscine Privée</div>
        <div style="font-size: 13px; color: #5a8a96;">Écouflant • Maine-et-Loire</div>
      </div>
      <div style="background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 4px 12px rgba(11,110,138,.08);">
        ${contenu}
      </div>
      <div style="text-align: center; margin-top: 16px; font-size: 11px; color: #aaa;">
        Cet email a été envoyé automatiquement, merci de ne pas y répondre directement.
      </div>
    </div>
  `;
}

function ligneInfo(label, valeur) {
  return `<tr><td style="padding: 4px 0; color: #5a8a96; font-size: 13px;">${label}</td><td style="padding: 4px 0; color: #2C3E50; font-size: 13px; font-weight: 600; text-align: right;">${valeur}</td></tr>`;
}

function formatEurEmail(n) { return (n || 0).toFixed(2).replace(".", ",") + " €"; }

// ─── Email : nouvelle demande de réservation (au propriétaire) ──────────────
export async function envoyerEmailNouvelleDemande(reservation, emailProprietaire) {
  const html = enveloppe(`
    <h2 style="color: #0B6E8A; margin-top: 0;">🔔 Nouvelle demande de réservation</h2>
    <p style="color: #2C3E50; font-size: 14px;">Une nouvelle demande de réservation est en attente de votre validation.</p>
    <table style="width: 100%; margin: 16px 0;">
      ${ligneInfo('Référence', reservation.ref)}
      ${ligneInfo('Locataire', `${reservation.prenom} ${reservation.nom}`)}
      ${ligneInfo('Date', reservation.date)}
      ${ligneInfo('Créneau', `${reservation.heureDebut}h → ${reservation.heureFin}h`)}
      ${ligneInfo('Participants', `${reservation.adultes} adulte(s)${reservation.enfants12 ? ` + ${reservation.enfants12} enfant(s)` : ''}`)}
      ${ligneInfo('Montant', formatEurEmail(reservation.totalGeneral || reservation.prix))}
    </table>
    <p style="color: #2C3E50; font-size: 14px;">Connectez-vous à votre espace propriétaire pour accepter ou refuser cette demande.</p>
  `);
  return envoyerEmail(emailProprietaire, `🔔 Nouvelle demande de réservation — ${reservation.ref}`, html);
}

// ─── Email : réservation acceptée (au locataire) ─────────────────────────────
export async function envoyerEmailAcceptation(reservation) {
  const html = enveloppe(`
    <h2 style="color: #0B6E8A; margin-top: 0;">🎉 Réservation confirmée !</h2>
    <p style="color: #2C3E50; font-size: 14px;">Bonne nouvelle ${reservation.prenom}, votre demande de réservation a été acceptée !</p>
    <table style="width: 100%; margin: 16px 0;">
      ${ligneInfo('Référence', reservation.ref)}
      ${ligneInfo('Date', reservation.date)}
      ${ligneInfo('Créneau', `${reservation.heureDebut}h → ${reservation.heureFin}h`)}
    </table>
    <p style="color: #2C3E50; font-size: 14px;">Le jour de votre venue, vous pourrez réaliser l'état des lieux d'entrée et de sortie directement depuis votre espace "Mon compte".</p>
    <p style="color: #2C3E50; font-size: 14px;">À bientôt ! 🌊</p>
  `);
  return envoyerEmail(reservation.email, `🎉 Réservation confirmée — ${reservation.ref}`, html);
}

// ─── Email : réservation refusée (au locataire) ──────────────────────────────
export async function envoyerEmailRefus(reservation) {
  const html = enveloppe(`
    <h2 style="color: #FF6B6B; margin-top: 0;">Demande non acceptée</h2>
    <p style="color: #2C3E50; font-size: 14px;">Bonjour ${reservation.prenom}, le propriétaire n'a pas pu accepter votre demande pour le créneau suivant :</p>
    <table style="width: 100%; margin: 16px 0;">
      ${ligneInfo('Référence', reservation.ref)}
      ${ligneInfo('Date', reservation.date)}
      ${ligneInfo('Créneau', `${reservation.heureDebut}h → ${reservation.heureFin}h`)}
    </table>
    ${reservation.motifRefus ? `<p style="color: #2C3E50; font-size: 14px; font-style: italic;">"${reservation.motifRefus}"</p>` : ''}
    <p style="color: #2C3E50; font-size: 14px;">Vous serez remboursé(e) intégralement. N'hésitez pas à choisir un autre créneau.</p>
  `);
  return envoyerEmail(reservation.email, `Demande refusée — ${reservation.ref}`, html);
}

// ─── Email : réservation annulée après acceptation (au locataire) ───────────
export async function envoyerEmailAnnulation(reservation) {
  const html = enveloppe(`
    <h2 style="color: #FF6B6B; margin-top: 0;">🚫 Réservation annulée</h2>
    <p style="color: #2C3E50; font-size: 14px;">Bonjour ${reservation.prenom}, votre réservation pourtant confirmée a dû être annulée :</p>
    <table style="width: 100%; margin: 16px 0;">
      ${ligneInfo('Référence', reservation.ref)}
      ${ligneInfo('Date', reservation.date)}
      ${ligneInfo('Créneau', `${reservation.heureDebut}h → ${reservation.heureFin}h`)}
    </table>
    ${reservation.motifAnnulation ? `<p style="color: #2C3E50; font-size: 14px; font-style: italic;">"${reservation.motifAnnulation}"</p>` : ''}
    <p style="color: #2C3E50; font-size: 14px;">Vous serez remboursé(e) intégralement. Nous sommes désolés pour la gêne occasionnée.</p>
  `);
  return envoyerEmail(reservation.email, `Réservation annulée — ${reservation.ref}`, html);
}
