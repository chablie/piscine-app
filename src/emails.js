// Module d'envoi d'emails — appelle la fonction serverless /api/envoyer-email
// qui elle-même contacte Resend de façon sécurisée.

// Numéro de la propriétaire pour les alertes SMS instantanées (format E.164)
const TELEPHONE_PROPRIO = "+33679419114";

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

async function envoyerSms(destinataire, message) {
  try {
    const reponse = await fetch('/api/envoyer-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinataire, message }),
    });
    if (!reponse.ok) {
      const err = await reponse.json().catch(() => ({}));
      console.error('Erreur envoi SMS:', err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Erreur réseau envoi SMS:', e);
    return false;
  }
}

// ─── SMS : nouvelle demande de réservation (alerte instantanée propriétaire) ──
export async function envoyerSmsNouvelleDemande(reservation) {
  const montant = reservation.totalGeneral ?? reservation.prix ?? 0;
  const message = `🔔 My Piscine Privée : nouvelle demande de ${reservation.prenom} ${reservation.nom} le ${reservation.date} de ${formatHeureEmail(reservation.heureDebut)} à ${formatHeureEmail(reservation.heureFin)} — ${formatEurEmail(montant)}. Réf ${reservation.ref}.`;
  return envoyerSms(TELEPHONE_PROPRIO, message);
}

// ─── Email : code promo reçu suite à une bonne note ──────────────────────────
export async function envoyerEmailCodePromo(reservation, note, promo) {
  const html = enveloppe(`
    <h2 style="color: #07a0f2; margin-top: 0;">🎁 Un code promo rien que pour vous !</h2>
    <p style="color: #2C3E50; font-size: 14px;">Bonjour ${reservation.prenom}, suite à votre venue, la propriétaire vous a attribué la note de <strong>${"⭐".repeat(note)}</strong> — merci d'avoir été un(e) locataire exemplaire !</p>
    <p style="color: #2C3E50; font-size: 14px;">Pour vous remercier, voici un code de réduction de <strong>-${promo.taux}%</strong> à utiliser sur votre prochaine réservation :</p>
    <div style="text-align:center; margin: 22px 0;">
      <div style="display:inline-block; background:#07a0f2; border-radius:12px; padding:14px 28px;">
        <div style="font-size:26px; font-weight:900; letter-spacing:4px; color:#fff; font-family:monospace;">${promo.code}</div>
      </div>
    </div>
    <p style="color: #888; font-size: 12px; text-align:center;">Valable jusqu'au <strong>${promo.expiration}</strong> · usage unique</p>
    <p style="color: #2C3E50; font-size: 14px;">À très bientôt à la piscine ! 🏊</p>
  `);
  return envoyerEmail(reservation.email, `🎁 -${promo.taux}% sur votre prochaine réservation !`, html);
}

// ─── Email : remboursement commercial effectué ───────────────────────────────
export async function envoyerEmailRemboursementCommercial(reservation, montantDemande, fraisGestion, netRembourse) {
  const html = enveloppe(`
    <h2 style="color: #07a0f2; margin-top: 0;">↩️ Remboursement effectué</h2>
    <p style="color: #2C3E50; font-size: 14px;">Bonjour ${reservation.prenom}, un remboursement commercial vient d'être effectué sur votre réservation <strong>${reservation.ref}</strong> :</p>
    <table style="width: 100%; margin: 16px 0;">
      ${ligneInfo('Montant du geste commercial', formatEurEmail(montantDemande))}
      ${ligneInfo('Frais de gestion (25%)', '− ' + formatEurEmail(fraisGestion))}
      ${ligneInfo('Montant remboursé', formatEurEmail(netRembourse))}
    </table>
    <p style="color: #2C3E50; font-size: 14px;">La somme de <strong>${formatEurEmail(netRembourse)}</strong> sera recréditée sur votre moyen de paiement d'origine sous quelques jours (délai bancaire habituel).</p>
  `);
  return envoyerEmail(reservation.email, `↩️ Remboursement effectué — ${reservation.ref}`, html);
}

// ─── Templates ──────────────────────────────────────────────────────────────
function enveloppe(contenu) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #f8f9fa; padding: 24px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="font-size: 32px;">🏊</div>
        <div style="font-size: 20px; font-weight: 700; color: #07a0f2; margin-top: 4px;">My Piscine Privée</div>
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

// Formate une heure décimale pour email : 14 → "14h00", 14.5 → "14h30"
function formatHeureEmail(h) {
  const n = parseFloat(h);
  const heure = Math.floor(n) % 24;
  const minutes = Math.round((n - Math.floor(n)) * 60);
  return `${heure}h${String(minutes).padStart(2, "0")}`;
}

// ─── Email : nouvelle demande de réservation (au propriétaire) ──────────────
export async function envoyerEmailNouvelleDemande(reservation, emailProprietaire) {
  const html = enveloppe(`
    <h2 style="color: #07a0f2; margin-top: 0;">🔔 Nouvelle demande de réservation</h2>
    <p style="color: #2C3E50; font-size: 14px;">Une nouvelle demande de réservation est en attente de votre validation.</p>
    <table style="width: 100%; margin: 16px 0;">
      ${ligneInfo('Référence', reservation.ref)}
      ${ligneInfo('Locataire', `${reservation.prenom} ${reservation.nom}`)}
      ${ligneInfo('Date', reservation.date)}
      ${ligneInfo('Créneau', `${formatHeureEmail(reservation.heureDebut)} → ${formatHeureEmail(reservation.heureFin)}`)}
      ${ligneInfo('Participants', `${reservation.adultes} adulte(s)${reservation.enfants12 ? ` + ${reservation.enfants12} enfant(s)` : ''}`)}
      ${ligneInfo('Montant', formatEurEmail(reservation.totalGeneral || reservation.prix))}
    </table>
    <p style="color: #2C3E50; font-size: 14px;">Connectez-vous à votre espace propriétaire pour accepter ou refuser cette demande.</p>
  `);
  return envoyerEmail(emailProprietaire, `🔔 Nouvelle demande de réservation — ${reservation.ref}`, html);
}

// ─── Email : réservation acceptée (au locataire) ─────────────────────────────
export async function envoyerEmailAcceptation(reservation) {
  const p = reservation.paiement;
  let blocPaiement = "";
  if (p?.statut === "paye") {
    // Cas rare : paiement déjà confirmé au moment de l'envoi de cet email
    blocPaiement = `
    <div style="background: #e6faf8; border: 1.5px solid #39b8f5; border-radius: 10px; padding: 14px 16px; margin: 16px 0;">
      <div style="font-size: 14px; font-weight: 700; color: #07a0f2; margin-bottom: 4px;">💳 Paiement effectué</div>
      <div style="font-size: 13px; color: #2C3E50;">
        Votre règlement de <strong>${formatEurEmail(p.montantPaye ?? p.montant)}</strong> a bien été reçu.
        ${reservation.modePaiement === "especes"
          ? ` Le solde de ${formatEurEmail((reservation.totalGeneral || reservation.prix || 0) - (p.montantPaye ?? p.montant))} sera à régler en espèces sur place.`
          : ""}
      </div>
    </div>`;
  } else if (p?.url) {
    // Cas nominal : lien de paiement envoyé à l'acceptation
    blocPaiement = `
    <div style="background: #f0fafc; border: 1.5px solid #39b8f5; border-radius: 10px; padding: 16px; margin: 16px 0; text-align: center;">
      <div style="font-size: 14px; font-weight: 700; color: #07a0f2; margin-bottom: 6px;">💳 Dernière étape : le règlement</div>
      <div style="font-size: 13px; color: #2C3E50; margin-bottom: 12px;">
        ${reservation.modePaiement === "especes"
          ? `Réglez l'acompte de <strong>${formatEurEmail(p.montant)}</strong> pour confirmer définitivement votre réservation. Le solde de ${formatEurEmail((reservation.totalGeneral || reservation.prix || 0) - p.montant)} sera à régler en espèces sur place.`
          : `Réglez <strong>${formatEurEmail(p.montant)}</strong> pour confirmer définitivement votre réservation.`}
      </div>
      <a href="${p.url}" style="display: inline-block; background: #07a0f2; color: #fff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 8px;">
        Payer ${formatEurEmail(p.montant)} en ligne
      </a>
      <div style="font-size: 11px; color: #5a8a96; margin-top: 10px;">Paiement sécurisé par Stripe. Vous retrouverez aussi ce lien dans votre espace "Mon compte".</div>
    </div>
    <p style="color: #a06000; font-size: 13px; background: #fff8e1; border-radius: 8px; padding: 10px 14px; margin: 0 0 16px;">
      ⏱️ <strong>Votre créneau n'est pas encore garanti.</strong> D'autres personnes peuvent avoir demandé le même horaire — le premier qui règle obtient la réservation. Nous vous conseillons de payer rapidement pour ne pas risquer de le voir attribué à quelqu'un d'autre.
    </p>`;
  }
  const html = enveloppe(`
    <h2 style="color: #07a0f2; margin-top: 0;">🎉 Réservation acceptée !</h2>
    <p style="color: #2C3E50; font-size: 14px;">Bonne nouvelle ${reservation.prenom}, votre demande de réservation a été acceptée !</p>
    <table style="width: 100%; margin: 16px 0;">
      ${ligneInfo('Référence', reservation.ref)}
      ${ligneInfo('Date', reservation.date)}
      ${ligneInfo('Créneau', `${formatHeureEmail(reservation.heureDebut)} → ${formatHeureEmail(reservation.heureFin)}`)}
    </table>
    ${blocPaiement}
    <p style="color: #2C3E50; font-size: 14px;">Le jour de votre venue, vous pourrez réaliser l'état des lieux d'entrée et de sortie directement depuis votre espace "Mon compte".</p>
    <p style="color: #2C3E50; font-size: 14px;">À bientôt ! 🌊</p>
  `);
  return envoyerEmail(reservation.email, `🎉 Réservation acceptée — ${reservation.ref}`, html);
}

// ─── Email : réservation refusée (au locataire) ──────────────────────────────
export async function envoyerEmailRefus(reservation) {
  const html = enveloppe(`
    <h2 style="color: #FF6B6B; margin-top: 0;">Demande non acceptée</h2>
    <p style="color: #2C3E50; font-size: 14px;">Bonjour ${reservation.prenom}, le propriétaire n'a pas pu accepter votre demande pour le créneau suivant :</p>
    <table style="width: 100%; margin: 16px 0;">
      ${ligneInfo('Référence', reservation.ref)}
      ${ligneInfo('Date', reservation.date)}
      ${ligneInfo('Créneau', `${formatHeureEmail(reservation.heureDebut)} → ${formatHeureEmail(reservation.heureFin)}`)}
    </table>
    ${reservation.motifRefus ? `<p style="color: #2C3E50; font-size: 14px; font-style: italic;">"${reservation.motifRefus}"</p>` : ''}
    <p style="color: #2C3E50; font-size: 14px;">Vous serez remboursé(e) intégralement. N'hésitez pas à choisir un autre créneau.</p>
  `);
  return envoyerEmail(reservation.email, `Demande refusée — ${reservation.ref}`, html);
}

// ─── Email : réservation annulée après acceptation (au locataire) ───────────
export async function envoyerEmailAnnulation(reservation) {
  const montantRembourse = reservation.paiement?.rembourse ? reservation.paiement.montantRembourseStripe : (reservation.montantRembourse ?? null);
  const dejaPayeMaisPasRembourse = reservation.paiement?.statut === "paye" && !reservation.paiement?.rembourse;
  let texteRemboursement;
  if (montantRembourse != null && reservation.paiement?.rembourse) {
    texteRemboursement = `Vous avez été remboursé(e) de <strong>${formatEurEmail(montantRembourse)}</strong> sur votre moyen de paiement d'origine (délai habituel de quelques jours selon votre banque).`;
  } else if (dejaPayeMaisPasRembourse) {
    texteRemboursement = "Votre remboursement est en cours de traitement, vous recevrez une confirmation séparée.";
  } else {
    texteRemboursement = "Aucune somme n'avait été prélevée, vous n'avez rien à faire.";
  }
  const html = enveloppe(`
    <h2 style="color: #FF6B6B; margin-top: 0;">🚫 Réservation annulée</h2>
    <p style="color: #2C3E50; font-size: 14px;">Bonjour ${reservation.prenom}, votre réservation pourtant confirmée a dû être annulée :</p>
    <table style="width: 100%; margin: 16px 0;">
      ${ligneInfo('Référence', reservation.ref)}
      ${ligneInfo('Date', reservation.date)}
      ${ligneInfo('Créneau', `${formatHeureEmail(reservation.heureDebut)} → ${formatHeureEmail(reservation.heureFin)}`)}
    </table>
    ${reservation.motifAnnulation ? `<p style="color: #2C3E50; font-size: 14px; font-style: italic;">"${reservation.motifAnnulation}"</p>` : ''}
    <p style="color: #2C3E50; font-size: 14px;">${texteRemboursement} Nous sommes désolés pour la gêne occasionnée.</p>
  `);
  return envoyerEmail(reservation.email, `Réservation annulée — ${reservation.ref}`, html);
}

// ─── Email : créneau perdu au profit d'un autre client plus rapide à payer ───
export async function envoyerEmailCreneauPerdu(reservation) {
  const html = enveloppe(`
    <h2 style="color: #FF6B6B; margin-top: 0;">⏱️ Créneau attribué à un autre client</h2>
    <p style="color: #2C3E50; font-size: 14px;">Bonjour ${reservation.prenom}, votre demande avait bien été acceptée, mais un autre client a réglé ce créneau avant vous :</p>
    <table style="width: 100%; margin: 16px 0;">
      ${ligneInfo('Référence', reservation.ref)}
      ${ligneInfo('Date', reservation.date)}
      ${ligneInfo('Créneau', `${formatHeureEmail(reservation.heureDebut)} → ${formatHeureEmail(reservation.heureFin)}`)}
    </table>
    <p style="color: #2C3E50; font-size: 14px;">Aucune somme ne vous a été prélevée. N'hésitez pas à choisir un autre créneau disponible — n'attendez pas trop longtemps pour régler la prochaine fois afin de garantir votre place !</p>
  `);
  return envoyerEmail(reservation.email, `Créneau attribué à un autre client — ${reservation.ref}`, html);
}

// ─── Notification : état des lieux de sortie à valider par la propriétaire ───
export async function envoyerEmailEdlAValider(reservation, emailProprio) {
  const anomalies = Object.entries(reservation.edlSortie?.reponses || {})
    .filter(([, rep]) => !rep.present || !rep.fonctionnel)
    .map(([item, rep]) => `${item} : ${!rep.present ? "absent" : "présent"}${!rep.fonctionnel ? ", non fonctionnel" : ""}`);
  const html = enveloppe(`
    <h2 style="color: #07a0f2; margin-top: 0;">📋 État des lieux à valider</h2>
    <p style="color: #2C3E50; font-size: 14px;">${reservation.prenom} ${reservation.nom} vient de clôturer sa session (réservation <strong>${reservation.ref}</strong>) et a signé son état des lieux de sortie.</p>
    ${anomalies.length
      ? `<div style="background:#fff3f3; border-radius:10px; padding:12px 14px; margin:14px 0;"><strong style="color:#c0302a;">⚠️ ${anomalies.length} anomalie(s) signalée(s) :</strong><ul style="color:#2C3E50; font-size:13px; margin:8px 0 0;">${anomalies.map(a => `<li>${a}</li>`).join("")}</ul></div>`
      : `<p style="color: #1a9850; font-size: 14px;">✅ Tous les éléments sont indiqués présents et fonctionnels.</p>`}
    ${reservation.edlSortie?.commentaire ? `<p style="color: #2C3E50; font-size: 13px; font-style: italic;">💬 « ${reservation.edlSortie.commentaire} »</p>` : ""}
    ${reservation.descriptionCasse ? `<p style="color: #c0302a; font-size: 13px;"><strong>Dégât signalé :</strong> ${reservation.descriptionCasse}</p>` : ""}
    <p style="color: #2C3E50; font-size: 14px;">Faites le tour de la piscine, puis validez cet état des lieux depuis votre espace propriétaire (onglet Résas).</p>
  `);
  return envoyerEmail(emailProprio, `📋 État des lieux à valider — ${reservation.ref}`, html);
}

// ─── SMS : alerte instantanée état des lieux à valider ───────────────────────
export async function envoyerSmsEdlAValider(reservation) {
  const message = `📋 My Piscine Privée : ${reservation.prenom} a clôturé sa session (${reservation.ref}). État des lieux signé, à valider dans ton espace après ton tour de la piscine.`;
  return envoyerSms(TELEPHONE_PROPRIO, message);
}
