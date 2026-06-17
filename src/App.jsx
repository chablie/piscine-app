import { useState, useMemo, useEffect, useCallback } from "react";
import {
  chargerAnnonce, sauvegarderAnnonce,
  chargerDisponibilites, sauvegarderDisponibilites, supprimerDateDisponibilite,
  chargerReservations, sauvegarderReservation,
  chargerComptes, sauvegarderCompte,
  chargerInventaire, sauvegarderInventaireItem, supprimerInventaireItem,
  chargerElementsEdl, sauvegarderElementsEdl,
  chargerExtras, sauvegarderExtras,
  chargerCodesPromo, sauvegarderCodePromo,
  chargerNotesLocataires, sauvegarderNoteLocataire,
  chargerConfig, sauvegarderConfig,
  ecouterReservations, ecouterAnnonce,
} from "./supabase.js";

// ─── Constantes ───────────────────────────────────────────────────────────────
const TARIF_BASE = 9;
const REGLEMENT = `RÈGLEMENT INTÉRIEUR – PISCINE PRIVÉE

1. Accès réservé aux personnes inscrites sur la réservation.
2. Douche obligatoire avant l'entrée dans l'eau.
3. Pas de verre ni bouteille en verre dans l'espace piscine.
4. Les enfants de moins de 12 ans doivent être surveillés en permanence par un adulte.
5. Interdiction de plonger (fond peu profond).
6. Respecter les horaires réservés — entrée et sortie ponctuelles.
7. Laisser les lieux dans l'état initial : mobilier replacé, déchets jetés.
8. Tout dégât constaté sera facturé au locataire.
9. Le propriétaire décline toute responsabilité en cas d'accident lié au non-respect du règlement.
10. En cas de problème, contacter immédiatement le propriétaire.`;

const MOBILIER = ["Transat 1","Transat 2","Transat 3","Transat 4","Table basse","Parasol","Douche extérieure","Portail d'accès","Local technique","Escalier piscine"];

const EXTRAS_DEFAUT = [
  { id:"e1", nom:"Zéro vis-à-vis", description:"Jardin + terrasse privatisés pour votre session. Aucun regard extérieur.", tarif:15, type:"forfait", emoji:"🌿", actif:true },
  { id:"e2", nom:"Barbecue", description:"Barbecue à charbon mis à disposition avec allumage. Charbon inclus.", tarif:5, type:"personne", emoji:"🍖", actif:true },
  { id:"e3", nom:"Hamac flottant", description:"Hamac gonflable pour se relaxer sur l'eau.", tarif:2, type:"personne", emoji:"🏝️", actif:true },
  { id:"e4", nom:"Bouée", description:"Bouée gonflable pour les enfants et adultes.", tarif:2, type:"personne", emoji:"🔵", actif:true },
];
const ALL_HOURS = [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
const TARIF_SOIREE = 1; // majoration €/pers/h après 20h

// ─── Comptes Admin & Propriétaire ──────────────────────────────────────────────
// Change ces identifiants avant de déployer !
const ADMIN_EMAIL = "aurelie.briand@yahoo.fr";
const ADMIN_PASSWORD = "M@rtinique.972";
const PROPRIO_EMAIL = "aurelie.briand@yahoo.fr";
const PROPRIO_PASSWORD = "M@rtinique.972";
const JOURS = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function prixTotal(adultes, enfants12, creneaux) {
  if (creneaux.length === 0) return 0;
  let total = 0;
  creneaux.forEach(h => {
    const tarif = TARIF_BASE + (h >= 20 ? TARIF_SOIREE : 0);
    const tarifEnfant = (TARIF_BASE * 0.5) + (h >= 20 ? TARIF_SOIREE * 0.5 : 0);
    total += adultes * tarif + enfants12 * tarifEnfant;
  });
  return +total.toFixed(2);
}

// Détail du prix pour affichage
function detailPrix(adultes, enfants12, creneaux) {
  const normal = creneaux.filter(h => h < 20);
  const soir = creneaux.filter(h => h >= 20);
  return { normal: normal.length, soir: soir.length };
}
function formatEur(n) { return (n || 0).toFixed(2).replace(".", ",") + " €"; }
function today() { return new Date().toISOString().split("T")[0]; }
function padH(h) { return h === 24 ? "00:00" : String(h).padStart(2, "0") + ":00"; }
function isoDate(y, m, d) { return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }

function genererCodePromo() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "PISCINE-";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  const exp = new Date();
  exp.setMonth(exp.getMonth() + 1);
  return { code, expiration: exp.toLocaleDateString("fr-FR"), dateExpISO: exp.toISOString().split("T")[0], utilise: false };
}

function heuresBloquees(reservations, date) {
  const blocked = new Set();
  // Les réservations refusées ne bloquent plus le créneau
  reservations.filter(r => r.date === date && r.statut !== "refusee" && r.statut !== "annulee").forEach(r => {
    const debut = parseInt(r.heureDebut), fin = parseInt(r.heureFin);
    for (let h = debut - 1; h < fin + 1; h++) blocked.add(h);
  });
  return blocked;
}

// Pour une date donnée : retourne le statut heure par heure
function statutHeures(disponibilites, reservations, date) {
  const plages = disponibilites[date] || [];
  const blocked = heuresBloquees(reservations, date);
  const result = {};
  ALL_HOURS.forEach(h => {
    const dispo = plages.some(p => h >= p.debut && h < p.fin);
    const res = reservations.find(r => r.date === date && r.statut !== "refusee" && r.statut !== "annulee" && parseInt(r.heureDebut) <= h && parseInt(r.heureFin) > h);
    if (res) result[h] = "reserve";
    else if (blocked.has(h)) result[h] = "tampon";
    else if (dispo) result[h] = "libre";
    else result[h] = "ferme";
  });
  return result;
}

// Vérifie si une heure est libre
function heureLibre(disponibilites, reservations, date, h) {
  const statuts = statutHeures(disponibilites, reservations, date);
  return statuts[h] === "libre";
}

// Vérifie que les créneaux sélectionnés + tampons sont cohérents
function tamponsOk(disponibilites, reservations, date, creneaux) {
  if (creneaux.length === 0) return true;
  const statuts = statutHeures(disponibilites, reservations, date);
  const min = Math.min(...creneaux);
  const max = Math.max(...creneaux);
  // L'heure avant et l'heure après doivent être libres ou hors plage
  const avant = statuts[min - 1];
  const apres = statuts[max + 1];
  if (avant === "reserve") return false;
  if (apres === "reserve") return false;
  return true;
}

// ─── Données annonce par défaut ───────────────────────────────────────────────
const ANNONCE_DEFAUT = {
  titre: "💦 Piscine chauffée & couverte à louer – détente, sport et plaisir au rendez-vous !",
  description: `Envie d'un moment de détente, d'un entraînement sportif ou d'un après-midi en famille ? Notre piscine privée s'adapte à toutes vos envies !

🏊 Piscine chauffée à 28°C, couverte, entretenue, de 11 m x 5 m, avec une profondeur de 1,10 m à 1,80 m : parfaite pour les longueurs sportives, les cours de natation, les jeux en famille ou simplement en solo-perso pour se relaxer.

🪑 Inclus gratuitement :
• 4 bains de soleil pour bronzer ou se reposer
• Fauteuils, table et chaises en extérieur
• Une tonnelle aménagée pour se détendre à l'ombre ou se changer en toute tranquillité
• 1 ballon de piscine pour s'amuser petits et grands
• 1 hamac flottant

👨‍👩‍👧‍👦 Idéal pour tous :
• Seul(e) pour se ressourcer
• Familles avec enfants (toujours la responsabilité exclusive de l'accompagnateur)
• Groupes d'amis en quête de fun
• Coachs sportifs et maîtres-nageurs pour organiser des cours ou séances privées
• Personnes âgées ou en rééducation pour un moment bien-être
• Couples en recherche d'un espace calme et agréable

🔒 Intimité modulable :
L'espace piscine est partiellement ouvert sur le jardin, mais reste discret (vis-à-vis léger). Pour plus d'intimité, des rideaux sont disponibles autour de la piscine et sous la tonnelle. Vous pouvez opter pour l'option « Zéro vis-à-vis » avec rideaux fermés et jardin/terrasse réservés.

🎉 Événements : Anniversaire, baby shower, moment entre amis, barbecue en famille ? Contactez-moi à l'avance pour organiser votre venue dans les meilleures conditions.`,
  adresse: "Écouflant", ville: "Écouflant", codePostal: "49000", pays: "France",
  capaciteMax: 10,
  equipements: {
    "piscineChauffee": true, "piscineCoverte": true, "piscineExterieure": false,
    "douche": true, "toilette": true, "jacuzzi": false, "sauna": false,
    "jardin": true, "transats": true, "tableChaises": true,
    "barbecue": true, "bouees": true, "jeuxExterieur": true,
    "tennis": false, "petanque": false, "wifi": false,
  },
  visAVis: "leger",
  presenceProprietaire: "occasionnellement",
  produitEntretien: "chlore",
  reglement: {
    enfants: true, naturisme: true, burkini: true, evenements: true,
    alcool: false, fumeur: false, animaux: true, musique: true,
  },
  delaiReservation: 2,
  precisions: [
    { id:"p1", emoji:"🛟", texte:"Enfants/Adultes non nageurs : le port de brassards ou de bouées est obligatoire. Les enfants restent sous la responsabilité exclusive des parents ou accompagnateurs." },
    { id:"p2", emoji:"🚿", texte:"Douche obligatoire avant la baignade." },
    { id:"p3", emoji:"💇", texte:"Cheveux longs doivent être attachés avant et durant la baignade." },
    { id:"p4", emoji:"💍", texte:"Bijoux interdits dans l'eau." },
    { id:"p5", emoji:"👙", texte:"Tenue de bain obligatoire. Seuls les maillots de bain adaptés sont autorisés." },
    { id:"p6", emoji:"☀️", texte:"Crème solaire : ne pas appliquer avant la baignade." },
    { id:"p7", emoji:"🤿", texte:"Plongeons autorisés uniquement dans la zone la plus profonde (1,80 m)." },
    { id:"p8", emoji:"🏃", texte:"Comportements à éviter : courir autour de la piscine, manger dans la piscine, fumer dans l'espace piscine." },
    { id:"p9", emoji:"🐶", texte:"Animaux acceptés hors de l'espace piscine, à l'extérieur uniquement." },
    { id:"p10", emoji:"🧘", texte:"Naturisme autorisé dans l'espace réservé et privatisé." },
    { id:"p11", emoji:"📅", texte:"Toute réservation effectuée est due. Aucun remboursement en cas de retard." },
    { id:"p12", emoji:"✅", texte:"En réservant, vous confirmez avoir pris connaissance des règles." },
  ],
  dispositifs: {
    barriere: false, bache: false, abri: true, alarme: false,
  },
  photos: [], // URLs des photos
  photoUne: null, // index de la photo mise en avant
  ouvert: true,
};

const EQUIPEMENTS_LABELS = {
  piscineChauffee:["🌡️","Piscine chauffée"], piscineCoverte:["🏊","Piscine couverte"],
  piscineExterieure:["🏊‍♂️","Piscine extérieure"], douche:["🚿","Douche"], toilette:["🚽","Toilette"],
  jacuzzi:["🛁","Jacuzzi"], sauna:["🧖","Sauna"], jardin:["☀️","Jardin"], transats:["⛱️","Transats"],
  tableChaises:["🪑","Table et chaises"], barbecue:["🍖","Barbecue"], bouees:["🤽","Bouées gonflables"],
  jeuxExterieur:["🥏","Jeux d'extérieur"], tennis:["🎾","Terrain de tennis"],
  petanque:["🎯","Terrain de pétanque"], wifi:["💻","Wi-Fi"],
};

// ─── Textes légaux (RGPD) ───────────────────────────────────────────────────
const RESPONSABLE_TRAITEMENT = "BRIAND Aurélie";
const ADRESSE_RESPONSABLE = "Lieu-dit Le Bois Sené, 49000 Écouflant";
const EMAIL_CONTACT_RGPD = "aurelie.briand@yahoo.fr";

const POLITIQUE_CONFIDENTIALITE = `POLITIQUE DE CONFIDENTIALITÉ

Dernière mise à jour : ${new Date().toLocaleDateString("fr-FR")}

1. RESPONSABLE DU TRAITEMENT

Le responsable du traitement des données collectées sur cette application est :
${RESPONSABLE_TRAITEMENT}
${ADRESSE_RESPONSABLE}
Email : ${EMAIL_CONTACT_RGPD}

2. DONNÉES COLLECTÉES

Dans le cadre de l'utilisation de cette application de réservation de piscine privée, les données suivantes sont collectées :
• Identité : prénom, nom
• Coordonnées : email, téléphone, adresse postale
• Données de réservation : dates, horaires, nombre de participants, montants payés
• Photos : état des lieux (mobilier, en cas de dégât signalé)
• Avis et commentaires laissés sur la prestation

Aucune donnée bancaire (numéro de carte) n'est collectée ni stockée par cette application — les paiements sont traités par un prestataire de paiement sécurisé tiers (Stripe), qui dispose de sa propre politique de confidentialité.

3. FINALITÉS DU TRAITEMENT

Ces données sont utilisées pour :
• Gérer les réservations et leur suivi (validation, refus, annulation)
• Établir les factures
• Assurer le suivi de la relation client (avis, codes promo)
• Réaliser des statistiques anonymisées sur l'activité

4. BASE LÉGALE

Le traitement de vos données repose sur l'exécution du contrat de location conclu avec vous lors de votre réservation, ainsi que sur votre consentement pour les éléments facultatifs (avis, photos).

5. DESTINATAIRES DES DONNÉES

Vos données sont accessibles uniquement par le responsable du traitement mentionné ci-dessus. Elles ne sont jamais vendues ni cédées à des tiers à des fins commerciales. Elles peuvent être transmises à des sous-traitants techniques strictement nécessaires au fonctionnement du service (hébergement de la base de données, traitement des paiements), qui sont tenus aux mêmes obligations de confidentialité.

6. DURÉE DE CONSERVATION

Vos données sont conservées pendant la durée nécessaire à la gestion de votre dossier, et au maximum 3 ans après votre dernière réservation, sauf obligation légale de conservation plus longue (comptabilité, litiges).

7. VOS DROITS

Conformément au Règlement Général sur la Protection des Données (RGPD), vous disposez des droits suivants sur vos données personnelles :
• Droit d'accès : obtenir une copie des données vous concernant
• Droit de rectification : corriger des données inexactes
• Droit à l'effacement : demander la suppression de vos données
• Droit à la limitation du traitement
• Droit d'opposition
• Droit à la portabilité de vos données

Vous pouvez exercer ces droits directement depuis votre espace "Mon compte" (suppression) ou en nous contactant à l'adresse : ${EMAIL_CONTACT_RGPD}

Vous disposez également du droit d'introduire une réclamation auprès de la Commission Nationale de l'Informatique et des Libertés (CNIL) — www.cnil.fr

8. SÉCURITÉ

Des mesures techniques sont mises en place pour protéger vos données contre tout accès non autorisé, perte ou divulgation (hébergement sécurisé, accès restreint).

9. COOKIES ET STOCKAGE LOCAL

Cette application utilise uniquement les cookies et le stockage technique strictement nécessaires à son fonctionnement (maintien de votre connexion, mémorisation de vos préférences de réservation en cours). Aucun cookie publicitaire ou de traçage tiers n'est utilisé.`;

const CGU_TEXTE = `CONDITIONS GÉNÉRALES D'UTILISATION

Dernière mise à jour : ${new Date().toLocaleDateString("fr-FR")}

1. OBJET

Les présentes conditions générales régissent l'utilisation de l'application de réservation de la piscine privée gérée par ${RESPONSABLE_TRAITEMENT}, et l'ensemble des réservations effectuées par son intermédiaire.

2. RÉSERVATION

Toute réservation implique l'acceptation pleine et entière des présentes conditions ainsi que du règlement intérieur de la piscine. Les réservations sont soumises à validation manuelle par le propriétaire ; elles ne sont définitivement confirmées qu'après cette validation.

3. PAIEMENT

Le paiement s'effectue en ligne par carte bancaire (intégralité du montant) ou, sur option, par un acompte de 20% en ligne avec solde en espèces le jour de la prestation. Toute réservation confirmée et non honorée par le locataire sans annulation préalable reste due intégralement.

4. ANNULATION

En cas de refus de la demande par le propriétaire, le client est intégralement remboursé. En cas d'annulation d'une réservation déjà acceptée (initiative du propriétaire ou demande du locataire), un remboursement intégral est également effectué, sauf circonstance particulière communiquée au client.

5. RESPONSABILITÉ

Le propriétaire ne pourra être tenu responsable des accidents corporels survenus dans l'enceinte de la piscine en cas de non-respect du règlement intérieur communiqué lors de la réservation. Chaque locataire reste responsable de la sécurité des personnes qu'il accompagne, notamment des enfants et personnes ne sachant pas nager.

6. ÉTAT DES LIEUX

Un état des lieux photographique est réalisé par le locataire à l'arrivée et au départ. Tout dégât constaté et non signalé pourra être facturé.

7. DONNÉES PERSONNELLES

Le traitement des données personnelles collectées dans le cadre de l'utilisation de cette application est décrit dans la Politique de confidentialité, consultable depuis l'application.

8. DROIT APPLICABLE

Les présentes conditions sont soumises au droit français. Tout litige relève des juridictions compétentes.`;

// ─── SVG Vagues ───────────────────────────────────────────────────────────────
function Waves() {
  return (
    <svg viewBox="0 0 1440 80" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 50, marginTop: -2 }}>
      <path fill="#F7F0E6" d="M0,40 C240,80 480,0 720,40 C960,80 1200,0 1440,40 L1440,80 L0,80 Z" />
    </svg>
  );
}

function StepDot({ n, active, done }) {
  return (
    <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: done ? "#4ECDC4" : active ? "#0B6E8A" : "rgba(255,255,255,.25)", color: done || active ? "#fff" : "rgba(255,255,255,.6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>
      {done ? "✓" : n}
    </div>
  );
}

function Stars({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "8px 0" }}>
      {[1, 2, 3, 4, 5].map(s => (
        <span key={s} onClick={() => onChange(s)} style={{ fontSize: 34, cursor: "pointer", filter: s <= value ? "none" : "grayscale(1) opacity(.35)", transition: "filter .2s" }}>⭐</span>
      ))}
    </div>
  );
}

function PhotoUploader({ label, photos, onChange, reference = null }) {
  const [renommageIdx, setRenommageIdx] = useState(null);
  const [nomTemp, setNomTemp] = useState("");

  function handleFiles(e) {
    const files = Array.from(e.target.files);
    Promise.all(files.map(f => new Promise(res => { const r = new FileReader(); r.onload = () => res({ name: f.name, url: r.result }); r.readAsDataURL(f); }))).then(nw => onChange([...photos, ...nw]));
  }

  function validerRenommage(i) {
    onChange(photos.map((p, j) => j === i ? { ...p, name: nomTemp || p.name } : p));
    setRenommageIdx(null);
    setNomTemp("");
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 5, color: "#2C3E50" }}>{label}</div>
      {reference && reference.length > 0 && (
        <div style={{ marginBottom: 7 }}>
          <div style={{ fontSize: 11, color: "#5a8a96", marginBottom: 3, fontWeight: 600 }}>📸 Référence :</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {reference.map((p, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={p.url} alt="" style={{ width: 55, height: 55, objectFit: "cover", borderRadius: 7, border: "2px solid #f0c040" }} />
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,.5)", color: "#fff", fontSize: 8, textAlign: "center", borderRadius: "0 0 5px 5px" }}>REF</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Deux boutons distincts : prendre une photo OU choisir dans la galerie */}
      <div style={{ display: "flex", gap: 6 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#4ECDC4", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          📷 Prendre une photo
          <input type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={handleFiles} />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#0B6E8A", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          🖼️ Choisir un fichier
          <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFiles} />
        </label>
      </div>
      {photos.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {photos.map((p, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ position: "relative" }}>
                <img src={p.url} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 7, border: "2px solid #4ECDC4" }} />
                <button onClick={() => onChange(photos.filter((_, j) => j !== i))} style={{ position: "absolute", top: -5, right: -5, background: "#FF6B6B", color: "#fff", border: "none", borderRadius: "50%", width: 17, height: 17, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>×</button>
              </div>
              {renommageIdx === i ? (
                <div style={{ display: "flex", gap: 3 }}>
                  <input autoFocus value={nomTemp} onChange={e => setNomTemp(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && validerRenommage(i)}
                    style={{ width: 64, fontSize: 10, padding: "2px 4px", borderRadius: 4, border: "1px solid #b0d8e3" }} />
                  <button onClick={() => validerRenommage(i)} style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4, background: "#0B6E8A", color: "#fff", border: "none", cursor: "pointer" }}>✓</button>
                </div>
              ) : (
                <div onClick={() => { setRenommageIdx(i); setNomTemp(p.name || ""); }}
                  style={{ fontSize: 10, color: "#5a8a96", cursor: "pointer", maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline dotted" }}
                  title="Cliquer pour renommer">
                  ✏️ {p.name || "photo"}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── Calendrier visuel ────────────────────────────────────────────────────────
function CalendrierDisponibilites({ disponibilites, reservations, onSelectDate, selectedDate }) {
  const [nav, setNav] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const { year, month } = nav;
  const todayStr = today();

  const premier = new Date(year, month, 1);
  const dernierJour = new Date(year, month + 1, 0).getDate();
  // Lundi=0
  let debutGrille = (premier.getDay() + 6) % 7;
  const cases = [];
  for (let i = 0; i < debutGrille; i++) cases.push(null);
  for (let d = 1; d <= dernierJour; d++) cases.push(d);

  function statutJour(d) {
    const iso = isoDate(year, month, d);
    if (iso < todayStr) return "passe";
    if (!disponibilites[iso] || disponibilites[iso].length === 0) return "ferme";
    const statuts = statutHeures(disponibilites, reservations, iso);
    const libres = ALL_HOURS.filter(h => statuts[h] === "libre");
    if (libres.length === 0) return "complet";
    return "dispo";
  }

  const couleurs = { passe: "#e0e0e0", ferme: "#f5d0d0", complet: "#fde8b0", dispo: "#c8f0ea", selected: "#0B6E8A" };
  const textCouleurs = { passe: "#aaa", ferme: "#c0706a", complet: "#a07000", dispo: "#0B6E8A", selected: "#fff" };

  return (
    <div>
      {/* Nav mois */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={() => setNav(n => { let m = n.month - 1, y = n.year; if (m < 0) { m = 11; y--; } return { year: y, month: m }; })}
          style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#0B6E8A", padding: "4px 10px" }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#0B6E8A" }}>{MOIS[month]} {year}</span>
        <button onClick={() => setNav(n => { let m = n.month + 1, y = n.year; if (m > 11) { m = 0; y++; } return { year: y, month: m }; })}
          style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#0B6E8A", padding: "4px 10px" }}>›</button>
      </div>
      {/* Jours semaine */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 3 }}>
        {JOURS.map(j => <div key={j} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#5a8a96", padding: "2px 0" }}>{j}</div>)}
      </div>
      {/* Cases */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
        {cases.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = isoDate(year, month, d);
          const st = statutJour(d);
          const sel = iso === selectedDate;
          const cliquable = st === "dispo";
          return (
            <div key={i} onClick={() => cliquable && onSelectDate(iso)}
              style={{
                borderRadius: 8, padding: "6px 2px", textAlign: "center",
                background: sel ? couleurs.selected : couleurs[st],
                color: sel ? textCouleurs.selected : textCouleurs[st],
                fontWeight: sel ? 700 : 600, fontSize: 13,
                cursor: cliquable ? "pointer" : "default",
                border: sel ? "2px solid #0B6E8A" : "2px solid transparent",
                transition: "all .15s",
              }}>
              {d}
            </div>
          );
        })}
      </div>
      {/* Légende */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {[["#c8f0ea", "#0B6E8A", "Disponible"], ["#fde8b0", "#a07000", "Complet"], ["#f5d0d0", "#c0706a", "Fermé"], ["#e0e0e0", "#aaa", "Passé"]].map(([bg, col, label]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: bg, border: `1px solid ${col}` }} />
            <span style={{ color: "#5a8a96" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sélecteur horaire par cases cliquables ──────────────────────────────────
function SelecteurHoraire({ disponibilites, reservations, date, creneaux, onToggle }) {
  const statuts = useMemo(() => statutHeures(disponibilites, reservations, date), [disponibilites, reservations, date]);

  function toggleHeure(h) {
    const st = statuts[h];
    if (st !== "libre") return;
    let next;
    if (creneaux.includes(h)) {
      // Désélectionner : on peut uniquement enlever une extrémité
      const min = Math.min(...creneaux), max = Math.max(...creneaux);
      if (h !== min && h !== max) return; // impossible de désélectionner au milieu
      next = creneaux.filter(c => c !== h);
    } else {
      // Sélectionner : doit être adjacent au bloc existant ou bloc vide
      if (creneaux.length === 0) {
        next = [h];
      } else {
        const min = Math.min(...creneaux), max = Math.max(...creneaux);
        if (h === min - 1 || h === max + 1) next = [...creneaux, h].sort((a,b)=>a-b);
        else return; // non adjacent
      }
    }
    // Vérifier les tampons vis-à-vis des autres réservations
    if (next.length > 0) {
      const allStatuts = statutHeures(disponibilites, reservations, date);
      const newMin = Math.min(...next), newMax = Math.max(...next);
      if (allStatuts[newMin - 1] === "reserve" || allStatuts[newMax + 1] === "reserve") return;
    }
    onToggle(next);
  }

  const coulBg = { libre: "#e6faf8", reserve: "#ffd6d6", tampon: "#ffe8b0", ferme: "#f0f0f0" };
  const coulText = { libre: "#0B6E8A", reserve: "#c0302a", tampon: "#a06000", ferme: "#bbb" };

  return (
    <div>
      <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 10, lineHeight: 1.5 }}>
        Tapez sur les créneaux <strong style={{color:"#0B6E8A"}}>libres</strong> pour les sélectionner. Vous devez choisir des créneaux consécutifs.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ALL_HOURS.map(h => {
          const st = statuts[h];
          const sel = creneaux.includes(h);
          const isMin = sel && h === Math.min(...creneaux);
          const isMax = sel && h === Math.max(...creneaux);
          const cliquable = st === "libre";
          // Adjacent au bloc = peut être sélectionné
          const adjacent = creneaux.length > 0 && (h === Math.min(...creneaux) - 1 || h === Math.max(...creneaux) + 1);

          let bg, color, border;
          if (sel) { bg = "#0B6E8A"; color = "#fff"; border = "2px solid #0B6E8A"; }
          else if (cliquable && (creneaux.length === 0 || adjacent)) { bg = "#e6faf8"; color = "#0B6E8A"; border = "2px dashed #4ECDC4"; }
          else { bg = coulBg[st] || "#f0f0f0"; color = coulText[st] || "#bbb"; border = "2px solid transparent"; }

          return (
            <div key={h} onClick={() => toggleHeure(h)}
              style={{
                borderRadius: 10, padding: "10px 6px", fontSize: 12, fontWeight: 700,
                background: bg, color, border,
                cursor: cliquable ? "pointer" : "not-allowed",
                minWidth: 56, textAlign: "center",
                transition: "all .15s",
                position: "relative",
              }}>
              {padH(h)}
              <br />
              <span style={{ fontSize: 10, fontWeight: 400, opacity: .85 }}>
                {sel ? (isMin && isMax ? "✓ 1h" : isMin ? "← début" : isMax ? "fin →" : "✓") : 
                 st === "reserve" ? "Réservé" : st === "tampon" ? "Tampon" : st === "ferme" ? "Fermé" : "Libre"}
              </span>
              {h >= 20 && st === "libre" && !sel && <div style={{ fontSize: 8, color: "#f0a500", marginTop: 1 }}>+1€/h 🌙</div>}
            </div>
          );
        })}
      </div>
      {creneaux.length > 0 && (
        <div style={{ marginTop: 12, background: "linear-gradient(135deg,#0B6E8A,#4ECDC4)", borderRadius: 10, padding: "10px 14px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {padH(Math.min(...creneaux))} → {padH(Math.max(...creneaux) + 1)}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{creneaux.length}h sélectionnée{creneaux.length > 1 ? "s" : ""}</div>
          <button onClick={() => onToggle([])} style={{ background: "rgba(255,255,255,.25)", border: "none", color: "#fff", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Effacer</button>
        </div>
      )}
      {/* Légende */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {[["#0B6E8A","#fff","Sélectionné"],["#e6faf8","#0B6E8A","Libre"],["#ffd6d6","#c0302a","Réservé"],["#ffe8b0","#a06000","Tampon"],["#f0f0f0","#bbb","Fermé"]].map(([bg,col,label])=>(
          <div key={label} style={{display:"flex",alignItems:"center",gap:3,fontSize:11}}>
            <div style={{width:12,height:12,borderRadius:3,background:bg,border:`1px solid ${col}`}}/>
            <span style={{color:"#5a8a96"}}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const card = { background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(11,110,138,.10)", padding: "20px 16px", marginBottom: 14 };
const btnP = { background: "linear-gradient(135deg,#0B6E8A,#4ECDC4)", color: "#fff", border: "none", borderRadius: 10, padding: "13px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer", width: "100%", marginTop: 8 };
const btnS = { background: "transparent", color: "#0B6E8A", border: "2px solid #0B6E8A", borderRadius: 10, padding: "11px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer", width: "100%", marginTop: 8 };
const lbl = { fontSize: 13, fontWeight: 600, color: "#0B6E8A", marginBottom: 4, display: "block" };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 15, border: "1.5px solid #b0d8e3", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: "Inter,sans-serif" };

// ─── Composant Gestion Annonce ───────────────────────────────────────────────
function GestionAnnonce({ annonce, setAnnonce, onVoir }) {
  const [ongletAnnonce, setOngletAnnonce] = useState("infos");
  const tabStyle = t => ({ flex:1, padding:"8px 0", borderRadius:7, fontSize:11, fontWeight:600, border:"none", cursor:"pointer", background:ongletAnnonce===t?"#0B6E8A":"#e8f4f7", color:ongletAnnonce===t?"#fff":"#0B6E8A" });

  // Brouillon local : les modifications ne sont appliquées qu'au clic sur "Enregistrer"
  const [brouillon, setBrouillon] = useState(annonce);
  const [sauvegarde, setSauvegarde] = useState(false);
  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false);
  const [erreurSauvegarde, setErreurSauvegarde] = useState(false);
  const [nouvellePrecision, setNouvellePrecision] = useState({ emoji:"📌", texte:"" });

  // Si les données arrivent après le montage (chargement Supabase asynchrone), on resynchronise
  // mais seulement si l'utilisateur n'a pas déjà commencé à modifier le brouillon
  const [premiereSyncFaite, setPremiereSyncFaite] = useState(false);
  useEffect(() => {
    if (!premiereSyncFaite && annonce) {
      setBrouillon(annonce);
      setPremiereSyncFaite(true);
    }
  }, [annonce, premiereSyncFaite]);

  const modifie = JSON.stringify(brouillon) !== JSON.stringify(annonce);

  async function enregistrer() {
    setEnregistrementEnCours(true);
    setErreurSauvegarde(false);
    const ok = await sauvegarderAnnonce(brouillon);
    setEnregistrementEnCours(false);
    if (ok) {
      setAnnonce(brouillon);
      setSauvegarde(true);
      setTimeout(() => setSauvegarde(false), 2500);
    } else {
      setErreurSauvegarde(true);
    }
  }

  function annulerModifs() {
    setBrouillon(annonce);
  }

  const BoutonSauvegarde = () => (
    <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:14 }}>
      <button onClick={enregistrer} disabled={!modifie || enregistrementEnCours}
        style={{ flex:1, padding:"12px", borderRadius:10, background: (modifie && !enregistrementEnCours) ? "linear-gradient(135deg,#0B6E8A,#4ECDC4)" : "#e0e0e0", color: (modifie && !enregistrementEnCours) ? "#fff" : "#aaa", border:"none", fontWeight:700, fontSize:14, cursor: (modifie && !enregistrementEnCours) ? "pointer" : "not-allowed", transition:"all .2s" }}>
        {enregistrementEnCours ? "⏳ Enregistrement..." : "💾 Enregistrer les modifications"}
      </button>
      {modifie && !enregistrementEnCours && (
        <button onClick={annulerModifs} style={{ padding:"12px 16px", borderRadius:10, background:"#fff", color:"#FF6B6B", border:"1.5px solid #FF6B6B", fontWeight:600, fontSize:13, cursor:"pointer" }}>
          Annuler
        </button>
      )}
    </div>
  );

  const BandeauStatut = () => (
    <>
      {sauvegarde && (
        <div style={{ background:"#e6faf8", border:"1.5px solid #4ECDC4", borderRadius:10, padding:"10px 14px", marginBottom:12, color:"#0B6E8A", fontWeight:600, fontSize:13, display:"flex", alignItems:"center", gap:8 }}>
          ✅ Modifications enregistrées avec succès
        </div>
      )}
      {erreurSauvegarde && (
        <div style={{ background:"#fff0f0", border:"1.5px solid #FF6B6B", borderRadius:10, padding:"10px 14px", marginBottom:12, color:"#c0302a", fontWeight:600, fontSize:13 }}>
          ❌ Erreur lors de l'enregistrement — vérifiez votre connexion et réessayez
        </div>
      )}
      {modifie && !sauvegarde && !enregistrementEnCours && (
        <div style={{ background:"#fff8e1", border:"1.5px solid #f0c040", borderRadius:10, padding:"10px 14px", marginBottom:12, color:"#a06000", fontWeight:600, fontSize:13, display:"flex", alignItems:"center", gap:8 }}>
          ⚠️ Modifications non enregistrées — pensez à cliquer sur "Enregistrer"
        </div>
      )}
    </>
  );

  return (
    <div>
      <BandeauStatut/>
      {/* Sous-onglets */}
      <div style={{ display:"flex", gap:5, marginBottom:14 }}>
        <button style={tabStyle("infos")} onClick={()=>setOngletAnnonce("infos")}>📝 Infos</button>
        <button style={tabStyle("photos")} onClick={()=>setOngletAnnonce("photos")}>📷 Photos</button>
        <button style={tabStyle("reglement")} onClick={()=>setOngletAnnonce("reglement")}>📋 Règles</button>
        <button style={tabStyle("securite")} onClick={()=>setOngletAnnonce("securite")}>🛡️ Sécu</button>
      </div>

      {/* Boutons aperçu / statut */}
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        <button onClick={onVoir} style={{ flex:1, padding:"9px", borderRadius:9, background:"#4ECDC4", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
          👁 Voir l'annonce
        </button>
        <button onClick={()=>setBrouillon(a=>({...a,ouvert:!a.ouvert}))}
          style={{ flex:1, padding:"9px", borderRadius:9, background:brouillon.ouvert?"#FF6B6B":"#4ECDC4", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
          {brouillon.ouvert?"✗ Fermer l'annonce":"✓ Ouvrir l'annonce"}
        </button>
      </div>

      {/* ── INFOS ── */}
      {ongletAnnonce==="infos" && (
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(11,110,138,.10)", padding:"20px 16px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", fontWeight:700, marginBottom:12 }}>📝 Informations générales</div>
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Titre</label>
            <input style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:14, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.titre} onChange={e=>setBrouillon(a=>({...a,titre:e.target.value}))}/>
          </div>
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Description</label>
            <textarea style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:12, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box", height:180, resize:"vertical", lineHeight:1.6 }} value={brouillon.description} onChange={e=>setBrouillon(a=>({...a,description:e.target.value}))}/>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:8, marginBottom:10 }}>
            <div><label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Adresse</label><input style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.adresse} onChange={e=>setBrouillon(a=>({...a,adresse:e.target.value}))}/></div>
            <div><label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>CP</label><input style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.codePostal} onChange={e=>setBrouillon(a=>({...a,codePostal:e.target.value}))}/></div>
            <div><label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Ville</label><input style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.ville} onChange={e=>setBrouillon(a=>({...a,ville:e.target.value}))}/></div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:6, display:"block" }}>Capacité maximale</label>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <button onClick={()=>setBrouillon(a=>({...a,capaciteMax:Math.max(1,a.capaciteMax-1)}))} style={{ width:32,height:32,borderRadius:"50%",border:"2px solid #0B6E8A",background:"#fff",color:"#0B6E8A",fontSize:18,fontWeight:700,cursor:"pointer" }}>−</button>
              <span style={{ fontWeight:700, fontSize:18 }}>{brouillon.capaciteMax} pers.</span>
              <button onClick={()=>setBrouillon(a=>({...a,capaciteMax:a.capaciteMax+1}))} style={{ width:32,height:32,borderRadius:"50%",border:"none",background:"#0B6E8A",color:"#fff",fontSize:18,fontWeight:700,cursor:"pointer" }}>+</button>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Vis-à-vis</label>
              <select style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.visAVis} onChange={e=>setBrouillon(a=>({...a,visAVis:e.target.value}))}>
                <option value="aucun">Aucun</option><option value="leger">Léger</option><option value="complet">Complet</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Présence</label>
              <select style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.presenceProprietaire} onChange={e=>setBrouillon(a=>({...a,presenceProprietaire:e.target.value}))}>
                <option value="oui">Oui</option><option value="non">Non</option><option value="occasionnellement">Occasionnellement</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Entretien</label>
              <select style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.produitEntretien} onChange={e=>setBrouillon(a=>({...a,produitEntretien:e.target.value}))}>
                <option value="chlore">Chlore</option><option value="sel">Sel</option><option value="brome">Brome</option><option value="autres">Autres</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:8, display:"block" }}>Équipements</label>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              {Object.entries(EQUIPEMENTS_LABELS).map(([k,[emoji,label]])=>(
                <label key={k} style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer", padding:"7px 9px", borderRadius:8, background:brouillon.equipements[k]?"#e6faf8":"#f5f5f5", border:`1px solid ${brouillon.equipements[k]?"#4ECDC4":"#e0e0e0"}` }}>
                  <input type="checkbox" checked={!!brouillon.equipements[k]} onChange={e=>setBrouillon(a=>({...a,equipements:{...a.equipements,[k]:e.target.checked}}))} style={{ accentColor:"#0B6E8A" }}/>
                  <span style={{ fontSize:12, fontWeight:600, color:brouillon.equipements[k]?"#0B6E8A":"#888" }}>{emoji} {label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Délai minimum avant réservation (heures)</label>
            <input type="number" min={0} max={72} style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:14, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.delaiReservation} onChange={e=>setBrouillon(a=>({...a,delaiReservation:+e.target.value}))}/>
          </div>
        </div>
      )}
      {ongletAnnonce==="infos" && <BoutonSauvegarde/>}

      {/* ── PHOTOS ── */}
      {ongletAnnonce==="photos" && (
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(11,110,138,.10)", padding:"20px 16px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", fontWeight:700, marginBottom:6 }}>📷 Photos</div>
          <div style={{ fontSize:13, color:"#5a8a96", marginBottom:12 }}>⭐ = photo principale · ▲▼ = réordonner · 🗑 = supprimer</div>
          <label style={{ display:"inline-block", padding:"10px 18px", background:"#0B6E8A", color:"#fff", borderRadius:9, cursor:"pointer", fontSize:14, fontWeight:700, marginBottom:14 }}>
            📷 Ajouter des photos
            <input type="file" multiple accept="image/*" style={{ display:"none" }} onChange={e=>{
              const files=Array.from(e.target.files);
              Promise.all(files.map(f=>new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(f);}))).then(urls=>{
                setBrouillon(a=>({...a,photos:[...a.photos,...urls],photoUne:a.photoUne??0}));
              });
            }}/>
          </label>
          {brouillon.photos.length===0 ? (
            <div style={{ color:"#5a8a96", fontSize:13, textAlign:"center", padding:"20px", border:"2px dashed #b0d8e3", borderRadius:10 }}>
              Aucune photo ajoutée
            </div>
          ) : brouillon.photos.map((url,i)=>(
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px", borderRadius:10, background:"#f0fafc", marginBottom:8, border:`2px solid ${brouillon.photoUne===i?"#f0c040":"#e0e0e0"}` }}>
              <img src={url} alt="" style={{ width:70,height:60,objectFit:"cover",borderRadius:8,flexShrink:0 }}/>
              <div style={{ flex:1, fontSize:12, color:"#5a8a96" }}>
                Photo {i+1}{brouillon.photoUne===i?" ⭐":""}
              </div>
              <div style={{ display:"flex", gap:4 }}>
                <button title="Photo principale" onClick={()=>setBrouillon(a=>({...a,photoUne:i}))} style={{ width:30,height:30,borderRadius:7,border:"none",background:brouillon.photoUne===i?"#f0c040":"#e8f4f7",cursor:"pointer",fontSize:14 }}>⭐</button>
                <button title="Monter" onClick={()=>setBrouillon(a=>{if(i===0)return a;const p=[...a.photos];[p[i-1],p[i]]=[p[i],p[i-1]];return{...a,photos:p,photoUne:a.photoUne===i?i-1:a.photoUne===i-1?i:a.photoUne};})} disabled={i===0} style={{ width:30,height:30,borderRadius:7,border:"none",background:"#e8f4f7",cursor:i===0?"not-allowed":"pointer",fontSize:12,opacity:i===0?.4:1 }}>▲</button>
                <button title="Descendre" onClick={()=>setBrouillon(a=>{if(i===a.photos.length-1)return a;const p=[...a.photos];[p[i],p[i+1]]=[p[i+1],p[i]];return{...a,photos:p,photoUne:a.photoUne===i?i+1:a.photoUne===i+1?i:a.photoUne};})} disabled={i===brouillon.photos.length-1} style={{ width:30,height:30,borderRadius:7,border:"none",background:"#e8f4f7",cursor:i===brouillon.photos.length-1?"not-allowed":"pointer",fontSize:12,opacity:i===brouillon.photos.length-1?.4:1 }}>▼</button>
                <button title="Supprimer" onClick={()=>setBrouillon(a=>{const p=a.photos.filter((_,j)=>j!==i);return{...a,photos:p,photoUne:p.length===0?null:a.photoUne===i?0:a.photoUne>i?a.photoUne-1:a.photoUne};})} style={{ width:30,height:30,borderRadius:7,border:"none",background:"#fff0f0",color:"#FF6B6B",cursor:"pointer",fontSize:14 }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {ongletAnnonce==="photos" && <BoutonSauvegarde/>}

      {/* ── RÈGLEMENT ── */}
      {ongletAnnonce==="reglement" && (
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(11,110,138,.10)", padding:"20px 16px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", fontWeight:700, marginBottom:12 }}>📋 Règlement & autorisations</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:8, marginBottom:14 }}>
            {[["enfants","👶","Convient aux enfants (0-12 ans)"],["naturisme","🧘","Naturisme autorisé"],
              ["burkini","👙","Burkini autorisé"],["evenements","🎉","Événements autorisés"],
              ["alcool","🍷","Alcool autorisé"],["fumeur","🚬","Espace fumeur"],
              ["animaux","🐾","Animaux acceptés"],["musique","🎵","Musique autorisée"]].map(([k,emoji,label])=>(
              <label key={k} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", padding:"10px 12px", borderRadius:10, background:brouillon.reglement[k]?"#e6faf8":"#f5f5f5", border:`1.5px solid ${brouillon.reglement[k]?"#4ECDC4":"#e0e0e0"}` }}>
                <input type="checkbox" checked={!!brouillon.reglement[k]} onChange={e=>setBrouillon(a=>({...a,reglement:{...a.reglement,[k]:e.target.checked}}))} style={{ width:18,height:18,accentColor:"#0B6E8A" }}/>
                <span style={{ fontSize:16 }}>{emoji}</span>
                <span style={{ fontSize:13, fontWeight:600, color:brouillon.reglement[k]?"#0B6E8A":"#888" }}>{label}</span>
                <span style={{ marginLeft:"auto", fontSize:16 }}>{brouillon.reglement[k]?"✅":"❌"}</span>
              </label>
            ))}
          </div>
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Délai minimum avant réservation (heures)</label>
            <input type="number" min={0} max={72} style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:14, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.delaiReservation} onChange={e=>setBrouillon(a=>({...a,delaiReservation:+e.target.value}))}/>
          </div>
          <div>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:8, display:"block" }}>Précisions supplémentaires (règles de vie sur place)</label>
            {brouillon.precisions.map((p, i) => (
              <div key={p.id} style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:8, background:"#f5f5f5", borderRadius:9, padding:"9px 10px" }}>
                <span style={{ fontSize:18, flexShrink:0 }}>{p.emoji}</span>
                <textarea value={p.texte} onChange={e=>setBrouillon(a=>({...a, precisions:a.precisions.map((x,j)=>j===i?{...x,texte:e.target.value}:x)}))}
                  style={{ flex:1, padding:"6px 8px", borderRadius:6, fontSize:12, border:"1px solid #d8d8d8", outline:"none", background:"#fff", boxSizing:"border-box", resize:"vertical", minHeight:36, lineHeight:1.5 }}/>
                <button onClick={()=>setBrouillon(a=>({...a, precisions:a.precisions.filter((_,j)=>j!==i)}))}
                  style={{ width:28, height:28, borderRadius:6, border:"none", background:"#fff0f0", color:"#FF6B6B", cursor:"pointer", fontSize:13, flexShrink:0 }}>🗑</button>
              </div>
            ))}
            {/* Ajout nouvelle règle */}
            <div style={{ display:"flex", gap:8, marginTop:10, background:"#f0fafc", borderRadius:9, padding:"10px", border:"1.5px dashed #4ECDC4" }}>
              <input value={nouvellePrecision.emoji} onChange={e=>setNouvellePrecision(p=>({...p,emoji:e.target.value}))} maxLength={2}
                style={{ width:42, padding:"6px", borderRadius:6, fontSize:16, textAlign:"center", border:"1px solid #b0d8e3", boxSizing:"border-box" }}/>
              <input value={nouvellePrecision.texte} onChange={e=>setNouvellePrecision(p=>({...p,texte:e.target.value}))}
                placeholder="Nouvelle règle..." style={{ flex:1, padding:"6px 8px", borderRadius:6, fontSize:12, border:"1px solid #b0d8e3", boxSizing:"border-box" }}/>
              <button onClick={()=>{
                if(!nouvellePrecision.texte.trim()) return;
                setBrouillon(a=>({...a, precisions:[...a.precisions, {id:"p"+Date.now(), ...nouvellePrecision}]}));
                setNouvellePrecision({emoji:"📌", texte:""});
              }} style={{ padding:"6px 14px", borderRadius:6, background:"#0B6E8A", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer", flexShrink:0 }}>+ Ajouter</button>
            </div>
          </div>
          <BoutonSauvegarde/>
        </div>
      )}

      {/* ── SÉCURITÉ ── */}
      {ongletAnnonce==="securite" && (
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(11,110,138,.10)", padding:"20px 16px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", fontWeight:700, marginBottom:6 }}>🛡️ Dispositifs de sécurité</div>
          <div style={{ fontSize:12, color:"#5a8a96", marginBottom:14, lineHeight:1.6 }}>
            Conformité <strong>loi du 03/01/2003</strong> — cochez les dispositifs installés :
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:8 }}>
            {[["barriere","🚧","Barrière de protection"],["bache","🟦","Bâche de sécurité"],
              ["abri","🏠","Abri de piscine"],["alarme","🔔","Alarme de sécurité"]].map(([k,emoji,label])=>(
              <label key={k} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", padding:"12px 14px", borderRadius:10, background:brouillon.dispositifs[k]?"#e6faf8":"#f5f5f5", border:`1.5px solid ${brouillon.dispositifs[k]?"#4ECDC4":"#e0e0e0"}` }}>
                <input type="checkbox" checked={!!brouillon.dispositifs[k]} onChange={e=>setBrouillon(a=>({...a,dispositifs:{...a.dispositifs,[k]:e.target.checked}}))} style={{ width:18,height:18,accentColor:"#0B6E8A" }}/>
                <span style={{ fontSize:20 }}>{emoji}</span>
                <span style={{ fontSize:13, fontWeight:600, color:brouillon.dispositifs[k]?"#0B6E8A":"#888" }}>{label}</span>
                <span style={{ marginLeft:"auto", fontSize:16 }}>{brouillon.dispositifs[k]?"✅":"❌"}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {ongletAnnonce==="securite" && <BoutonSauvegarde/>}
    </div>
  );
}

// ─── Composant Stats Avancées ────────────────────────────────────────────────
function StatsAvancees({ reservations, comptes, extras }) {
  const card = { background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(11,110,138,.10)", padding: "20px 16px", marginBottom: 14 };

  const locatairesAvecCompte = reservations.map(r => comptes[r.email]).filter(Boolean);

  // ── Géo ──
  const parVille = {};
  locatairesAvecCompte.forEach(c => {
    if (!c.ville) return;
    const key = `${c.codePostal} ${c.ville}`;
    parVille[key] = (parVille[key]||0) + 1;
  });
  const villesSorted = Object.entries(parVille).sort((a,b)=>b[1]-a[1]);
  const totalGeo = locatairesAvecCompte.filter(c=>c.ville).length;
  const parDept = {};
  locatairesAvecCompte.forEach(c => {
    if (!c.codePostal) return;
    const dept = c.codePostal.slice(0,2);
    parDept[dept] = (parDept[dept]||0) + 1;
  });
  const deptSorted = Object.entries(parDept).sort((a,b)=>b[1]-a[1]);

  // ── Démographie ──
  const totalAdultes = reservations.reduce((s,r)=>s+(r.adultes||0),0);
  const totalEnfants12 = reservations.reduce((s,r)=>s+(r.enfants12||0),0);
  const totalMoins3 = reservations.reduce((s,r)=>s+(r.moins3||0),0);
  const totalPersonnes = totalAdultes + totalEnfants12 + totalMoins3;
  const pctA = totalPersonnes ? Math.round(totalAdultes/totalPersonnes*100) : 0;
  const pctE = totalPersonnes ? Math.round(totalEnfants12/totalPersonnes*100) : 0;
  const pctB = totalPersonnes ? Math.round(totalMoins3/totalPersonnes*100) : 0;

  // ── CA / KPIs globaux ──
  const caTotal = reservations.reduce((s,r)=>s+(r.totalGeneral||r.prix||0),0);
  const nbRes = reservations.length;
  const panierMoyen = nbRes ? +(caTotal/nbRes).toFixed(2) : 0;
  const noteMoyenneLocataire = (() => { const notes=reservations.filter(r=>r.note).map(r=>r.note); return notes.length ? (notes.reduce((s,n)=>s+n,0)/notes.length).toFixed(1) : null; })();

  // ── Taux d'acceptation / refus / annulation ──
  const nbEnAttente = reservations.filter(r=>r.statut==="en_attente").length;
  const nbAcceptees = reservations.filter(r=>r.statut==="acceptee").length;
  const nbRefusees = reservations.filter(r=>r.statut==="refusee").length;
  const nbAnnulees = reservations.filter(r=>r.statut==="annulee").length;
  const nbTraitees = nbAcceptees + nbRefusees + nbAnnulees; // hors en_attente, pour calculer un taux sur les décisions prises
  const pctAcceptees = nbTraitees ? Math.round(nbAcceptees/nbTraitees*100) : 0;
  const pctRefusees = nbTraitees ? Math.round(nbRefusees/nbTraitees*100) : 0;
  const pctAnnulees = nbTraitees ? Math.round(nbAnnulees/nbTraitees*100) : 0;
  const nbAnnuleesParLocataire = reservations.filter(r=>r.statut==="annulee" && r.annulationParLocataire).length;

  // ── Satisfaction prestation (avis du locataire) ──
  const avisPrestation = reservations.filter(r=>r.note).map(r=>r.note);
  const repartitionAvis = [5,4,3,2,1].map(n => ({ note:n, nb: avisPrestation.filter(a=>a===n).length }));
  const maxAvis = Math.max(1, ...repartitionAvis.map(r=>r.nb));

  // ── Évolution CA par mois ──
  const caParMois = {};
  reservations.forEach(r => {
    if (!r.date) return;
    const mois = r.date.slice(0,7); // "YYYY-MM"
    caParMois[mois] = (caParMois[mois]||0) + (r.totalGeneral||r.prix||0);
  });
  const moisSorted = Object.keys(caParMois).sort();
  const maxCaMois = Math.max(1, ...Object.values(caParMois));
  const NOMS_MOIS_COURT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  function labelMois(m) { const [y,mo] = m.split("-"); return `${NOMS_MOIS_COURT[+mo-1]} ${y.slice(2)}`; }

  // ── Utilisation des extras ──
  const extrasUtilisation = extras.map(e => {
    const resasAvecExtra = reservations.filter(r => r.extrasChoisis?.[e.id] > 0);
    const revenuExtra = resasAvecExtra.reduce((sum, r) => {
      const qte = r.extrasChoisis[e.id];
      const nb = e.type === "personne" ? qte : 1;
      return sum + e.tarif * nb;
    }, 0);
    return { ...e, nbUtilisations: resasAvecExtra.length, revenu: revenuExtra };
  }).sort((a,b)=>b.nbUtilisations-a.nbUtilisations);
  const totalUtilisationsExtras = extrasUtilisation.reduce((s,e)=>s+e.nbUtilisations,0);

  // ── Répartition mode de paiement ──
  const nbCB = reservations.filter(r=>r.modePaiement==="cb").length;
  const nbEspeces = reservations.filter(r=>r.modePaiement==="especes").length;
  const totalPaiements = nbCB + nbEspeces;
  const pctCB = totalPaiements ? Math.round(nbCB/totalPaiements*100) : 0;
  const pctEspeces = totalPaiements ? Math.round(nbEspeces/totalPaiements*100) : 0;
  const caEspecesEnAttente = reservations.filter(r=>r.modePaiement==="especes").reduce((s,r)=>s+(r.resteARegler||0),0);

  return (
    <div>
      {/* KPIs globaux */}
      <div style={card}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, color:"#0B6E8A", marginBottom:14, fontWeight:700 }}>📊 Tableau de bord</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:4 }}>
          {[["📅","Réservations",nbRes],["💶","CA total",formatEur(caTotal)],["🛒","Panier moyen",formatEur(panierMoyen)],["⭐","Satisfaction",noteMoyenneLocataire?`${noteMoyenneLocataire}/5`:"—"]].map(([emoji,label,val])=>(
            <div key={label} style={{ background:"#f0fafc", borderRadius:10, padding:"12px 10px", border:"1px solid #b0d8e3", textAlign:"center" }}>
              <div style={{ fontSize:22 }}>{emoji}</div>
              <div style={{ fontWeight:700, fontSize:16, color:"#0B6E8A", marginTop:2 }}>{val}</div>
              <div style={{ fontSize:10, color:"#5a8a96", marginTop:1 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Taux d'acceptation / refus / annulation */}
      <div style={card}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", marginBottom:12, fontWeight:700 }}>📋 Demandes de réservation</div>
        {nbEnAttente > 0 && (
          <div style={{ background:"#fff8e1", borderRadius:8, padding:"8px 12px", fontSize:12, color:"#a06000", fontWeight:600, marginBottom:12 }}>
            ⏳ {nbEnAttente} demande{nbEnAttente>1?"s":""} actuellement en attente
          </div>
        )}
        {nbTraitees === 0 ? (
          <div style={{ color:"#5a8a96", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucune demande traitée pour l'instant.</div>
        ) : (
          <>
            <div style={{ display:"flex", height:28, borderRadius:10, overflow:"hidden", marginBottom:12 }}>
              {pctAcceptees>0 && <div style={{ width:`${pctAcceptees}%`, background:"#4ECDC4", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctAcceptees}%</div>}
              {pctRefusees>0 && <div style={{ width:`${pctRefusees}%`, background:"#f0c040", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctRefusees}%</div>}
              {pctAnnulees>0 && <div style={{ width:`${pctAnnulees}%`, background:"#FF6B6B", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctAnnulees}%</div>}
            </div>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:8 }}>
              {[["#4ECDC4","Acceptées",nbAcceptees],["#f0c040","Refusées",nbRefusees],["#FF6B6B","Annulées",nbAnnulees]].map(([bg,label,nb])=>(
                <div key={label} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:12, height:12, borderRadius:3, background:bg }}/>
                  <span style={{ fontSize:12, color:"#2C3E50" }}>{label} : <strong>{nb}</strong></span>
                </div>
              ))}
            </div>
            {nbAnnulees > 0 && (
              <div style={{ fontSize:11, color:"#5a8a96", marginBottom:10 }}>
                Dont {nbAnnuleesParLocataire} annulation{nbAnnuleesParLocataire>1?"s":""} demandée{nbAnnuleesParLocataire>1?"s":""} par le locataire
              </div>
            )}

            {/* Motifs détaillés des refus */}
            {reservations.filter(r=>r.statut==="refusee" && r.motifRefus).length > 0 && (
              <div style={{ marginTop:12 }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#a06000", marginBottom:8 }}>Motifs de refus</div>
                {reservations.filter(r=>r.statut==="refusee" && r.motifRefus).map(r => (
                  <div key={r.ref} style={{ background:"#fff8e1", borderRadius:8, padding:"8px 12px", marginBottom:6, fontSize:12 }}>
                    <div style={{ fontWeight:600, color:"#a06000" }}>{r.ref} · {r.date}</div>
                    <div style={{ color:"#2C3E50", marginTop:2 }}>"{r.motifRefus}"</div>
                  </div>
                ))}
              </div>
            )}

            {/* Motifs détaillés des annulations */}
            {reservations.filter(r=>r.statut==="annulee" && r.motifAnnulation).length > 0 && (
              <div style={{ marginTop:12 }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#c0302a", marginBottom:8 }}>Motifs d'annulation</div>
                {reservations.filter(r=>r.statut==="annulee" && r.motifAnnulation).map(r => (
                  <div key={r.ref} style={{ background:"#fff0f0", borderRadius:8, padding:"8px 12px", marginBottom:6, fontSize:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontWeight:600, color:"#c0302a" }}>{r.ref} · {r.date}</span>
                      {r.annulationParLocataire && (
                        <span style={{ fontSize:10, background:"#FF6B6B", color:"#fff", borderRadius:10, padding:"2px 7px", fontWeight:600 }}>demandé par le locataire</span>
                      )}
                    </div>
                    <div style={{ color:"#2C3E50", marginTop:2 }}>"{r.motifAnnulation}"</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Satisfaction locataire détaillée */}
      <div style={card}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", marginBottom:12, fontWeight:700 }}>⭐ Satisfaction des locataires</div>
        {avisPrestation.length === 0 ? (
          <div style={{ color:"#5a8a96", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucun avis laissé pour l'instant.</div>
        ) : (
          <>
            <div style={{ textAlign:"center", marginBottom:14 }}>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:32, fontWeight:700, color:"#0B6E8A" }}>{noteMoyenneLocataire}<span style={{fontSize:16,color:"#aaa"}}>/5</span></div>
              <div style={{ fontSize:12, color:"#5a8a96" }}>{avisPrestation.length} avis sur la prestation</div>
            </div>
            {repartitionAvis.map(({note,nb}) => (
              <div key={note} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                <span style={{ fontSize:12, color:"#5a8a96", width:30 }}>{note} ⭐</span>
                <div style={{ flex:1, height:10, background:"#f0f0f0", borderRadius:5, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${(nb/maxAvis)*100}%`, background:"linear-gradient(90deg,#f0c040,#ffe082)", borderRadius:5 }}/>
                </div>
                <span style={{ fontSize:12, color:"#2C3E50", fontWeight:600, width:20, textAlign:"right" }}>{nb}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Évolution CA par mois */}
      <div style={card}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", marginBottom:12, fontWeight:700 }}>📈 Évolution du chiffre d'affaires</div>
        {moisSorted.length === 0 ? (
          <div style={{ color:"#5a8a96", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucune donnée disponible.</div>
        ) : (
          <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:140, overflowX:"auto", paddingBottom:4 }}>
            {moisSorted.map(m => (
              <div key={m} style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0, minWidth:44 }}>
                <div style={{ fontSize:10, color:"#0B6E8A", fontWeight:700, marginBottom:3 }}>{formatEur(caParMois[m])}</div>
                <div style={{ width:32, height:Math.max(4,(caParMois[m]/maxCaMois)*90), background:"linear-gradient(180deg,#4ECDC4,#0B6E8A)", borderRadius:"6px 6px 0 0" }}/>
                <div style={{ fontSize:11, color:"#5a8a96", marginTop:5 }}>{labelMois(m)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Utilisation des extras */}
      <div style={card}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", marginBottom:12, fontWeight:700 }}>🎁 Utilisation des extras</div>
        {totalUtilisationsExtras === 0 ? (
          <div style={{ color:"#5a8a96", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucun extra utilisé pour l'instant.</div>
        ) : (
          extrasUtilisation.filter(e=>e.nbUtilisations>0).map(e => (
            <div key={e.id} style={{ marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3 }}>
                <span style={{ fontWeight:600, color:"#2C3E50" }}>{e.emoji} {e.nom}</span>
                <span style={{ color:"#0B6E8A", fontWeight:700 }}>{e.nbUtilisations}× · {formatEur(e.revenu)}</span>
              </div>
              <div style={{ height:7, background:"#e8f4f7", borderRadius:4, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${(e.nbUtilisations/totalUtilisationsExtras)*100}%`, background:"linear-gradient(90deg,#0B6E8A,#4ECDC4)", borderRadius:4 }}/>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Répartition mode de paiement */}
      <div style={card}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", marginBottom:12, fontWeight:700 }}>💳 Modes de paiement</div>
        {totalPaiements === 0 ? (
          <div style={{ color:"#5a8a96", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucune donnée disponible.</div>
        ) : (
          <>
            <div style={{ display:"flex", height:28, borderRadius:10, overflow:"hidden", marginBottom:12 }}>
              {pctCB>0 && <div style={{ width:`${pctCB}%`, background:"#0B6E8A", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctCB}%</div>}
              {pctEspeces>0 && <div style={{ width:`${pctEspeces}%`, background:"#4ECDC4", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctEspeces}%</div>}
            </div>
            <div style={{ display:"flex", gap:16, marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:12, height:12, borderRadius:3, background:"#0B6E8A" }}/>
                <span style={{ fontSize:12, color:"#2C3E50" }}>💳 Carte : <strong>{nbCB}</strong></span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:12, height:12, borderRadius:3, background:"#4ECDC4" }}/>
                <span style={{ fontSize:12, color:"#2C3E50" }}>💵 Espèces : <strong>{nbEspeces}</strong></span>
              </div>
            </div>
            {caEspecesEnAttente > 0 && (
              <div style={{ background:"#fff8e1", borderRadius:8, padding:"8px 12px", fontSize:12, color:"#a06000", fontWeight:600 }}>
                💰 {formatEur(caEspecesEnAttente)} restant à encaisser en espèces
              </div>
            )}
          </>
        )}
      </div>

      {/* Géographie */}
      <div style={card}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", marginBottom:12, fontWeight:700 }}>📍 Origine géographique</div>
        {totalGeo === 0 ? (
          <div style={{ color:"#5a8a96", fontSize:13, textAlign:"center", padding:"12px 0" }}>
            Aucune donnée. Les locataires inscrits avec adresse apparaîtront ici.
          </div>
        ) : (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
              {[["🏙️","Villes",villesSorted.length],["🗺️","Départements",deptSorted.length],["👤","Géolocalisés",totalGeo],["📌","Ville #1",villesSorted[0]?.[0]?.split(" ").slice(1).join(" ")||"—"]].map(([emoji,label,val])=>(
                <div key={label} style={{ background:"#f0fafc", borderRadius:9, padding:"10px", border:"1px solid #b0d8e3", textAlign:"center" }}>
                  <div style={{ fontSize:18 }}>{emoji}</div>
                  <div style={{ fontWeight:700, fontSize:14, color:"#0B6E8A" }}>{val}</div>
                  <div style={{ fontSize:10, color:"#5a8a96" }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#0B6E8A", marginBottom:8 }}>Par ville</div>
              {villesSorted.map(([ville,nb])=>{
                const pct=Math.round(nb/totalGeo*100);
                return (
                  <div key={ville} style={{ marginBottom:8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3 }}>
                      <span style={{ fontWeight:600, color:"#2C3E50" }}>{ville}</span>
                      <span style={{ color:"#0B6E8A", fontWeight:700 }}>{nb} · {pct}%</span>
                    </div>
                    <div style={{ height:7, background:"#e8f4f7", borderRadius:4, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg,#0B6E8A,#4ECDC4)", borderRadius:4 }}/>
                    </div>
                  </div>
                );
              })}
            </div>
            {deptSorted.length>0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {deptSorted.map(([dept,nb])=>(
                  <div key={dept} style={{ background:"#0B6E8A", color:"#fff", borderRadius:8, padding:"6px 12px", fontSize:13, fontWeight:700, textAlign:"center" }}>
                    {dept}<br/><span style={{fontSize:10,fontWeight:400}}>{nb} loc.</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Démographie */}
      <div style={card}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", marginBottom:12, fontWeight:700 }}>👥 Répartition des participants</div>
        {totalPersonnes === 0 ? (
          <div style={{ color:"#5a8a96", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucune donnée disponible.</div>
        ) : (
          <>
            <div style={{ display:"flex", height:28, borderRadius:10, overflow:"hidden", marginBottom:12 }}>
              {pctA>0 && <div style={{ width:`${pctA}%`, background:"#0B6E8A", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctA}%</div>}
              {pctE>0 && <div style={{ width:`${pctE}%`, background:"#4ECDC4", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctE}%</div>}
              {pctB>0 && <div style={{ width:`${pctB}%`, background:"#ffe082", display:"flex", alignItems:"center", justifyContent:"center", color:"#a06000", fontSize:11, fontWeight:700 }}>{pctB}%</div>}
            </div>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:12 }}>
              {[["#0B6E8A","Adultes (12+)",totalAdultes,pctA],["#4ECDC4","Enfants (3-11)",totalEnfants12,pctE],["#ffe082","Moins de 3 ans",totalMoins3,pctB]].map(([bg,label,nb,pct])=>(
                <div key={label} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:12, height:12, borderRadius:3, background:bg }}/>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:"#2C3E50" }}>{label}</div>
                    <div style={{ fontSize:11, color:"#5a8a96" }}>{nb} pers. · {pct}%</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background:"#f0fafc", borderRadius:8, padding:"9px 12px", fontSize:13, color:"#0B6E8A", fontWeight:600, textAlign:"center" }}>
              Total : {totalPersonnes} participant{totalPersonnes>1?"s":""} sur {nbRes} réservation{nbRes>1?"s":""}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState("accueil"); // accueil | locataire | proprio | auth | compte
  const [consentementCookies, setConsentementCookies] = useState(null); // null = pas encore répondu | true | false
  const [modeOrigineAvantLegal, setModeOrigineAvantLegal] = useState("accueil"); // pour revenir après consultation des pages légales
  const [confirmationSuppression, setConfirmationSuppression] = useState(false);
  const [chargementInitial, setChargementInitial] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(false);
  const [photoAffichee, setPhotoAffichee] = useState(0);
  const [galerieOuverte, setGalerieOuverte] = useState(false);
  const [step, setStep] = useState(1);

  // Remonter en haut de la page à chaque changement de mode ou d'étape
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode, step]);

  // ── Admin (technique) & Propriétaire (métier) ──
  const [adminConnecte, setAdminConnecte] = useState(false);
  const [proprioConnecte, setProprioConnecte] = useState(false);
  const [modeMainenance, setModeMaintenance] = useState(false);
  const [messageMainenance, setMessageMaintenance] = useState("🔧 L'application est momentanément en maintenance. Nous revenons très bientôt !");
  const [authAdmin, setAuthAdmin] = useState({ email:"", password:"" });
  const [erreurAdmin, setErreurAdmin] = useState("");
  const [authProprio, setAuthProprio] = useState({ email:"", password:"" });
  const [erreurProprio, setErreurProprio] = useState("");

  // ── Annonce ──
  const [annonce, setAnnonce] = useState(ANNONCE_DEFAUT);

  // ── Base de données simulée ──
  // Disponibilités initialisées : 7h→00h00 par défaut pour les 90 prochains jours
  const [disponibilites, setDisponibilites] = useState(() => {
    const defs = {};
    const d = new Date();
    for (let i = 0; i < 90; i++) {
      const iso = new Date(d.getTime() + i*86400000).toISOString().split("T")[0];
      defs[iso] = [{ debut:7, fin:24 }];
    }
    return defs;
  });
  const [reservations, setReservations] = useState([]);
  const [inventaire, setInventaire] = useState({});
  const [elementsEdl, setElementsEdl] = useState(MOBILIER);
  const [nouvelElementEdl, setNouvelElementEdl] = useState("");
  const [registreCodes, setRegistreCodes] = useState({});
  const [comptes, setComptes] = useState({}); // { email: { prenom, nom, telephone, motdepasse, reservations:[] } }
  const [notesLocataires, setNotesLocataires] = useState({});
  // Extras configurables
  const [extras, setExtras] = useState(EXTRAS_DEFAUT);

  // ── Chargement initial depuis Supabase ──
  useEffect(() => {
    let annule = false;
    async function chargerTout() {
      try {
        const [
          annonceData, dispoData, resaData, comptesData,
          inventaireData, elementsData, extrasData, codesData, notesData, configData
        ] = await Promise.all([
          chargerAnnonce(), chargerDisponibilites(), chargerReservations(), chargerComptes(),
          chargerInventaire(), chargerElementsEdl(), chargerExtras(), chargerCodesPromo(),
          chargerNotesLocataires(), chargerConfig(),
        ]);
        if (annule) return;

        if (annonceData) setAnnonce(annonceData);
        else { await sauvegarderAnnonce(ANNONCE_DEFAUT); } // première initialisation

        if (dispoData && Object.keys(dispoData).length > 0) setDisponibilites(dispoData);
        else {
          // Première fois : on initialise Supabase avec les 90 jours par défaut déjà en mémoire
          await sauvegarderDisponibilites(disponibilites);
        }

        setReservations(resaData || []);
        setComptes(comptesData || {});
        setInventaire(inventaireData || {});

        if (elementsData) setElementsEdl(elementsData);
        else { await sauvegarderElementsEdl(MOBILIER); }

        if (extrasData) setExtras(extrasData);
        else { await sauvegarderExtras(EXTRAS_DEFAUT); }

        setRegistreCodes(codesData || {});
        setNotesLocataires(notesData || {});

        if (configData) {
          setModeMaintenance(configData.mode_maintenance || false);
          setMessageMaintenance(configData.message_maintenance || messageMainenance);
        } else {
          await sauvegarderConfig(false, messageMainenance);
        }
      } catch (e) {
        console.error("Erreur de chargement Supabase:", e);
        if (!annule) setErreurChargement(true);
      } finally {
        if (!annule) setChargementInitial(false);
      }
    }
    chargerTout();
    return () => { annule = true; };
  }, []);

  // ── Temps réel : se mettre à jour automatiquement quand un autre appareil modifie les données ──
  useEffect(() => {
    const stopResa = ecouterReservations(() => {
      chargerReservations().then(setReservations);
    });
    const stopAnnonce = ecouterAnnonce(() => {
      chargerAnnonce().then(d => { if (d) setAnnonce(d); });
    });
    return () => { stopResa(); stopAnnonce(); };
  }, []);

  // ── Sauvegarde automatique vers Supabase à chaque changement (après le chargement initial) ──
  useEffect(() => {
    if (chargementInitial) return;
    sauvegarderDisponibilites(disponibilites);
  }, [disponibilites, chargementInitial]);

  useEffect(() => {
    if (chargementInitial) return;
    // On sauvegarde chaque élément d'inventaire individuellement
    Object.entries(inventaire).forEach(([item, photos]) => {
      sauvegarderInventaireItem(item, photos);
    });
  }, [inventaire, chargementInitial]);

  useEffect(() => {
    if (chargementInitial) return;
    sauvegarderElementsEdl(elementsEdl);
  }, [elementsEdl, chargementInitial]);

  useEffect(() => {
    if (chargementInitial) return;
    sauvegarderExtras(extras);
  }, [extras, chargementInitial]);

  useEffect(() => {
    if (chargementInitial) return;
    Object.entries(notesLocataires).forEach(([ref, note]) => {
      sauvegarderNoteLocataire(ref, note);
    });
  }, [notesLocataires, chargementInitial]);

  useEffect(() => {
    if (chargementInitial) return;
    sauvegarderConfig(modeMainenance, messageMainenance);
  }, [modeMainenance, messageMainenance, chargementInitial]);

  // ── Session locataire ──
  const [compteConnecte, setCompteConnecte] = useState(null); // email

  // ── Alertes état des lieux ──
  const [alerteEdl, setAlerteEdl] = useState(null); // null | "entree" | "sortie"
  const [edlResaRef, setEdlResaRef] = useState(null);

  // ── Formulaire réservation ──
  const [form, setForm] = useState({ prenom: "", nom: "", email: "", telephone: "", date: "", creneaux: [], adultes: 1, enfants12: 0, moins3: 0, reglementAccepte: false });
  const [extrasChoisis, setExtrasChoisis] = useState({}); // { id: true/false }
  const [modePaiement, setModePaiement] = useState(null); // "cb" | "especes" 
  const [photosAvant, setPhotosAvant] = useState([]);
  const [photosApres, setPhotosApres] = useState([]);
  const [photosCasse, setPhotosCasse] = useState([]);
  const [signalementCasse, setSignalementCasse] = useState(false);
  const [descriptionCasse, setDescriptionCasse] = useState("");
  const [reservation, setReservation] = useState(null);
  const [erreurs, setErreurs] = useState({});

  // ── Avis ──
  const [note, setNote] = useState(0);
  const [commentaire, setCommentaire] = useState("");
  const [avisEnvoye, setAvisEnvoye] = useState(false);
  const [codePromo, setCodePromo] = useState(null);
  const [codePromoSaisi, setCodePromoSaisi] = useState("");
  const [codePromoStatut, setCodePromoStatut] = useState(null);
  const [remise, setRemise] = useState(0);

  // ── Auth ──
  const [authMode, setAuthMode] = useState("login"); // login | register
  const [authForm, setAuthForm] = useState({ prenom: "", nom: "", email: "", telephone: "", adresse: "", codePostal: "", ville: "", motdepasse: "", motdepasse2: "" });
  const [authErreur, setAuthErreur] = useState("");

  // ── Proprio ──
  const [propriDate, setPropriDate] = useState(today());
  const [propriDebut, setPropriDebut] = useState(9);
  const [propriFin, setProprieFin] = useState(20);
  const [ongletPropri, setOngletPropri] = useState("dispo");
  const [noteEnCoursRef, setNoteEnCoursRef] = useState(null);
  const [refusEnCoursRef, setRefusEnCoursRef] = useState(null);
  const [annulEnCoursRef, setAnnulEnCoursRef] = useState(null);
  const [motifAnnulVal, setMotifAnnulVal] = useState("");
  const [annulationParLocataireVal, setAnnulationParLocataireVal] = useState(false);
  const [motifRefusVal, setMotifRefusVal] = useState("");
  const [nouvelExtra, setNouvelExtra] = useState({ nom:"", description:"", tarif:0, type:"forfait", emoji:"✨", actif:true });
  const [ajoutExtraMode, setAjoutExtraMode] = useState(false);
  const [extraEnEdition, setExtraEnEdition] = useState(null);
  const [periodeDebut, setPeriodeDebut] = useState("");
  const [periodeFin, setPeriodeFin] = useState("");
  const [noteProprioVal, setNoteProprioVal] = useState(0);
  const [commentaireProprioVal, setCommentaireProprioVal] = useState("");

  // ── Fonctions admin ──
  function connecterAdmin() {
    if (authAdmin.email === ADMIN_EMAIL && authAdmin.password === ADMIN_PASSWORD) {
      setAdminConnecte(true);
      setErreurAdmin("");
      setMode("proprio");
    } else {
      setErreurAdmin("Email ou mot de passe incorrect.");
    }
  }

  function deconnecterAdmin() {
    setAdminConnecte(false);
    setMode("accueil");
  }

  function connecterProprio() {
    if (authProprio.email === PROPRIO_EMAIL && authProprio.password === PROPRIO_PASSWORD) {
      setProprioConnecte(true);
      setErreurProprio("");
      setMode("proprio");
    } else {
      setErreurProprio("Email ou mot de passe incorrect.");
    }
  }

  function deconnecterProprio() {
    setProprioConnecte(false);
    setMode("accueil");
  }

  // Consentement cookies : lu une seule fois au démarrage
  useEffect(() => {
    try {
      const stocke = localStorage.getItem("consentement_cookies");
      if (stocke === "true") setConsentementCookies(true);
      else if (stocke === "false") setConsentementCookies(false);
    } catch (e) { /* localStorage indisponible, on redemande à chaque fois */ }
  }, []);

  function repondreConsentement(accepte) {
    setConsentementCookies(accepte);
    try { localStorage.setItem("consentement_cookies", String(accepte)); } catch (e) {}
  }

  // Quand on arrive sur la page annonce, démarrer le carrousel sur la photo mise en avant
  useEffect(() => {
    if (mode === "annonce") setPhotoAffichee(annonce.photoUne || 0);
  }, [mode]);

  // Surveillance horaire pour déclencher les états des lieux
  useEffect(() => {
    const verifier = () => {
      const maintenant = new Date();
      const heure = maintenant.getHours();
      const dateAujourdhui = maintenant.toISOString().split("T")[0];

      reservations.forEach(r => {
        if (r.date !== dateAujourdhui) return;
        if (r.statut !== "acceptee") return; // seules les réservations validées déclenchent un état des lieux
        // Si un locataire est connecté, on ne l'alerte que pour SA réservation (pas celle des autres)
        if (compteConnecte && r.email !== compteConnecte) return;
        // Si personne n'est connecté (admin/proprio non plus), pas d'alerte côté locataire anonyme
        if (!compteConnecte && !adminConnecte && !proprioConnecte) return;
        // Début de session → alerte état des lieux d'entrée
        if (heure === r.heureDebut && !r.edlEntreeFait) {
          setAlerteEdl("entree");
          setEdlResaRef(r.ref);
        }
        // Fin de session → alerte état des lieux de sortie
        if (heure === r.heureFin && !r.edlSortieFait) {
          setAlerteEdl("sortie");
          setEdlResaRef(r.ref);
        }
      });
    };
    verifier();
    const interval = setInterval(verifier, 60000); // vérifier chaque minute
    return () => clearInterval(interval);
  }, [reservations, compteConnecte, adminConnecte, proprioConnecte]);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }
  const duree = form.creneaux.length;
  const heureDebut = duree > 0 ? Math.min(...form.creneaux) : null;
  const heureFin = duree > 0 ? Math.max(...form.creneaux) + 1 : null;
  const prix = prixTotal(form.adultes, form.enfants12, form.creneaux);
  const prixFinal = remise > 0 ? +(prix * (1 - remise / 100)).toFixed(2) : prix;

  // Calcul extras
  const totalExtras = extras.filter(e => e.actif && extrasChoisis[e.id] > 0).reduce((sum, e) => {
    const qte = extrasChoisis[e.id] || 0;
    const nb = e.type === "personne" ? qte : 1;
    return sum + e.tarif * nb;
  }, 0);
  const totalGeneral = +(prixFinal + totalExtras).toFixed(2);
  const acompte = modePaiement === "especes" ? +(totalGeneral * 0.20).toFixed(2) : totalGeneral;
  const resteARegler = modePaiement === "especes" ? +(totalGeneral * 0.80).toFixed(2) : 0;

  // ── Auth functions ──
  function inscrire() {
    const { prenom, nom, email, telephone, motdepasse, motdepasse2, cguAcceptees } = authForm;
    if (!prenom || !nom || !email.includes("@") || !telephone || !motdepasse) { setAuthErreur("Tous les champs sont requis."); return; }
    if (motdepasse !== motdepasse2) { setAuthErreur("Les mots de passe ne correspondent pas."); return; }
    if (!cguAcceptees) { setAuthErreur("Vous devez accepter les CGU et la politique de confidentialité."); return; }
    if (comptes[email]) { setAuthErreur("Un compte existe déjà avec cet email."); return; }
    const { adresse, codePostal, ville } = authForm;
    if (!adresse || !codePostal || !ville) { setAuthErreur("Veuillez renseigner votre adresse complète."); return; }
    const nouveau = { prenom, nom, email, telephone, adresse, codePostal, ville, motdepasse, reservations: [] };
    setComptes(prev => ({ ...prev, [email]: nouveau }));
    sauvegarderCompte(email, nouveau);
    setCompteConnecte(email);
    setForm(f => ({ ...f, prenom, nom, email, telephone }));
    setAuthErreur("");
    setMode("locataire"); setStep(1);
  }

  function connecter() {
    const { email, motdepasse } = authForm;
    const compte = comptes[email];
    if (!compte || compte.motdepasse !== motdepasse) { setAuthErreur("Email ou mot de passe incorrect."); return; }
    setCompteConnecte(email);
    setForm(f => ({ ...f, prenom: compte.prenom, nom: compte.nom, email, telephone: compte.telephone }));
    setAuthErreur("");
    setMode("locataire"); setStep(1);
  }

  function deconnecter() { setCompteConnecte(null); setMode("accueil"); }

  // Droit à l'effacement RGPD : suppression du compte locataire et de ses données
  async function supprimerMonCompte() {
    if (!compteConnecte) return;
    // Supprimer le compte de Supabase (anonymisation simple : on retire les infos identifiantes)
    const { supabase } = await import("./supabase.js");
    await supabase.from('comptes').delete().eq('email', compteConnecte);
    setComptes(prev => { const n = { ...prev }; delete n[compteConnecte]; return n; });
    setCompteConnecte(null);
    setConfirmationSuppression(false);
    setMode("accueil");
  }

  // ── Réservation functions ──
  function validerEtape1() {
    const e = {};
    if (!form.prenom.trim()) e.prenom = "Requis";
    if (!form.nom.trim()) e.nom = "Requis";
    if (!form.email.includes("@")) e.email = "Email invalide";
    if (!form.telephone.trim()) e.telephone = "Requis";
    if (!form.date) e.date = "Sélectionnez une date";
    if (form.creneaux.length === 0) e.creneaux = "Sélectionnez au moins un créneau";
    if (form.adultes < 1) e.adultes = "Minimum 1 adulte";
    setErreurs(e);
    return Object.keys(e).length === 0;
  }

  function verifierCode() {
    const code = codePromoSaisi.trim().toUpperCase();
    if (!code) { setCodePromoStatut("invalide"); return; }
    const entree = registreCodes[code];
    if (!entree) { setCodePromoStatut("invalide"); return; }
    if (entree.utilise) { setCodePromoStatut("utilise"); return; }
    if (entree.dateExpISO < today()) { setCodePromoStatut("expire"); return; }
    setCodePromoStatut("ok"); setRemise(5);
  }

  function annulerCode() { setCodePromoSaisi(""); setCodePromoStatut(null); setRemise(0); }

  function marquerEdlEntree(ref) {
    setReservations(prev => {
      const next = prev.map(r => r.ref === ref ? { ...r, edlEntreeFait: true } : r);
      const updated = next.find(r => r.ref === ref);
      if (updated) sauvegarderReservation(updated);
      return next;
    });
    setAlerteEdl(null);
  }

  // Validation de l'état des lieux d'entrée le jour J (depuis la page edlEntree)
  function validerEdlEntree() {
    setReservations(prev => {
      const next = prev.map(r => r.ref === reservation?.ref ? { ...r, photosAvant, edlEntreeFait: true } : r);
      const updated = next.find(r => r.ref === reservation?.ref);
      if (updated) sauvegarderReservation(updated);
      return next;
    });
    setAlerteEdl(null);
    setMode(compteConnecte ? "compte" : "accueil");
  }

  function marquerEdlSortie(ref) {
    setReservations(prev => {
      const next = prev.map(r => r.ref === ref ? { ...r, edlSortieFait: true } : r);
      const updated = next.find(r => r.ref === ref);
      if (updated) sauvegarderReservation(updated);
      return next;
    });
    setAlerteEdl(null);
  }

  function confirmerReservation() {
    const ref = "RES-" + Date.now().toString(36).toUpperCase();
    const compteInfo = compteConnecte ? comptes[compteConnecte] : {};
    const r = { ...form, heureDebut, heureFin, prix: prixFinal, remise, extrasChoisis, totalExtras, totalGeneral, modePaiement, acompte, resteARegler, ref, photosAvant: [], photosApres: [], adresse: compteInfo.adresse||"", codePostal: compteInfo.codePostal||"", ville: compteInfo.ville||"", statut: "en_attente" };
    setReservations(prev => [...prev, r]);
    setReservation(r);
    sauvegarderReservation(r);
    // L'état des lieux d'entrée et de sortie se font le jour J, depuis "Mon compte" ou via la bannière d'alerte
    // TODO: déclencher ici l'envoi email/SMS au propriétaire "Nouvelle demande de réservation"
    if (codePromoStatut === "ok" && codePromoSaisi) {
      const code = codePromoSaisi.trim().toUpperCase();
      setRegistreCodes(prev => {
        const next = { ...prev, [code]: { ...prev[code], utilise: true } };
        sauvegarderCodePromo(code, next[code]);
        return next;
      });
    }
    // Associer au compte locataire
    if (compteConnecte) {
      setComptes(prev => {
        const next = { ...prev, [compteConnecte]: { ...prev[compteConnecte], reservations: [...(prev[compteConnecte].reservations || []), ref] } };
        sauvegarderCompte(compteConnecte, next[compteConnecte]);
        return next;
      });
    }
    setStep(5);
  }

  function accepterReservation(ref) {
    setReservations(prev => {
      const next = prev.map(r => r.ref === ref ? { ...r, statut: "acceptee" } : r);
      const updated = next.find(r => r.ref === ref);
      if (updated) sauvegarderReservation(updated);
      return next;
    });
    // TODO: déclencher ici l'envoi email/SMS au locataire "Réservation acceptée"
  }

  function refuserReservation(ref, motif) {
    setReservations(prev => {
      const next = prev.map(r => r.ref === ref ? { ...r, statut: "refusee", motifRefus: motif || "" } : r);
      const updated = next.find(r => r.ref === ref);
      if (updated) sauvegarderReservation(updated);
      return next;
    });
    // TODO: déclencher ici l'envoi email/SMS au locataire "Réservation refusée" + remboursement
  }

  // Annulation d'une réservation déjà acceptée (initiative propriétaire ou demande locataire relayée)
  function annulerReservation(ref, motif, origineLocataire) {
    setReservations(prev => {
      const next = prev.map(r => r.ref === ref ? { ...r, statut: "annulee", motifAnnulation: motif || "", annulationParLocataire: !!origineLocataire } : r);
      const updated = next.find(r => r.ref === ref);
      if (updated) sauvegarderReservation(updated);
      return next;
    });
    // TODO: déclencher ici l'envoi email/SMS au locataire "Réservation annulée" + remboursement
  }

  function cloturerSession() {
    setReservations(prev => {
      const next = prev.map(r => r.ref === reservation?.ref ? { ...r, photosApres, photosCasse, descriptionCasse, edlSortieFait: true } : r);
      const updated = next.find(r => r.ref === reservation?.ref);
      if (updated) sauvegarderReservation(updated);
      return next;
    });
    if (reservation?.ref) marquerEdlSortie(reservation.ref);
    setMode("locataire"); setStep(7);
  }

  function soumettreAvis() {
    if (note === 0) return;
    const noteP = notesLocataires[reservation?.ref];
    const promo = (noteP && noteP.note >= 4) ? genererCodePromo() : null;
    setCodePromo(promo);
    if (promo) {
      const codeData = { expiration: promo.expiration, dateExpISO: promo.dateExpISO, utilise: false, reservationRef: reservation?.ref };
      setRegistreCodes(prev => ({ ...prev, [promo.code]: codeData }));
      sauvegarderCodePromo(promo.code, codeData);
    }
    setReservations(prev => {
      const next = prev.map(r => r.ref === reservation?.ref ? { ...r, note, commentaire, codePromo: promo } : r);
      const updated = next.find(r => r.ref === reservation?.ref);
      if (updated) sauvegarderReservation(updated);
      return next;
    });
    setAvisEnvoye(true);
  }

  // ── Helpers disponibilités ──
  function estOuvert(date, h) {
    return (disponibilites[date]||[]).some(p => h >= p.debut && h < p.fin);
  }

  function ouvrirPlage(date, debut, fin) {
    if (debut >= fin) return;
    setDisponibilites(prev => {
      const merged = [...(prev[date]||[]), {debut, fin}]
        .sort((a,b)=>a.debut-b.debut)
        .reduce((acc,cur)=>{ if(acc.length&&cur.debut<=acc[acc.length-1].fin) acc[acc.length-1].fin=Math.max(acc[acc.length-1].fin,cur.fin); else acc.push({...cur}); return acc; },[]);
      return {...prev, [date]: merged};
    });
  }

  function fermerPlage(date, debut, fin) {
    setDisponibilites(prev => {
      const plages = prev[date]||[];
      const nouvelles = [];
      plages.forEach(p => {
        if (fin <= p.debut || debut >= p.fin) { nouvelles.push(p); }
        else {
          if (p.debut < debut) nouvelles.push({debut:p.debut, fin:debut});
          if (fin < p.fin) nouvelles.push({debut:fin, fin:p.fin});
        }
      });
      if (!nouvelles.length) { const n={...prev}; delete n[date]; return n; }
      return {...prev, [date]: nouvelles};
    });
  }

  function toutOuvrir(date) { ouvrirPlage(date, 7, 24); }
  function toutFermer(date) {
    setDisponibilites(prev => { const n={...prev}; delete n[date]; return n; });
  }

  function nbJoursPeriode(d1, d2) {
    const diff = new Date(d2) - new Date(d1);
    return Math.max(1, Math.round(diff/86400000)+1);
  }

  function itererPeriode(d1, d2, fn) {
    if (!d1||!d2||d2<d1) return;
    const cur = new Date(d1+"T12:00:00");
    const fin = new Date(d2+"T12:00:00");
    while (cur <= fin) {
      fn(cur.toISOString().split("T")[0]);
      cur.setDate(cur.getDate()+1);
    }
  }

  function ouvrirPeriode(d1, d2) { itererPeriode(d1, d2, d => ouvrirPlage(d, 7, 24)); }
  function fermerPeriode(d1, d2) { itererPeriode(d1, d2, d => toutFermer(d)); }

  function soumettreNoteLocataire(ref) {
    if (noteProprioVal === 0) return;
    setNotesLocataires(prev => ({ ...prev, [ref]: { note: noteProprioVal, commentaire: commentaireProprioVal } }));
    setNoteEnCoursRef(null); setNoteProprioVal(0); setCommentaireProprioVal("");
  }

  function ajouterPlage() {
    if (propriDebut >= propriFin) return;
    setDisponibilites(prev => {
      const merged = [...(prev[propriDate] || []), { debut: propriDebut, fin: propriFin }].sort((a, b) => a.debut - b.debut).reduce((acc, cur) => { if (acc.length && cur.debut <= acc[acc.length - 1].fin) acc[acc.length - 1].fin = Math.max(acc[acc.length - 1].fin, cur.fin); else acc.push({ ...cur }); return acc; }, []);
      return { ...prev, [propriDate]: merged };
    });
  }

  // Toggle un créneau d'1h dans les disponibilités proprio
  function toggleCreneauProprio(h) {
    setDisponibilites(prev => {
      const plages = prev[propriDate] || [];
      const estOuvert = plages.some(p => h >= p.debut && h < p.fin);
      let nouvPlages;
      if (estOuvert) {
        // Fermer ce créneau : découper les plages existantes
        nouvPlages = [];
        plages.forEach(p => {
          if (h >= p.fin || h < p.debut) { nouvPlages.push(p); }
          else {
            if (p.debut < h) nouvPlages.push({ debut: p.debut, fin: h });
            if (h + 1 < p.fin) nouvPlages.push({ debut: h + 1, fin: p.fin });
          }
        });
      } else {
        // Ouvrir ce créneau : ajouter et fusionner
        nouvPlages = [...plages, { debut: h, fin: h + 1 }]
          .sort((a, b) => a.debut - b.debut)
          .reduce((acc, cur) => {
            if (acc.length && cur.debut <= acc[acc.length - 1].fin)
              acc[acc.length - 1].fin = Math.max(acc[acc.length - 1].fin, cur.fin);
            else acc.push({ ...cur });
            return acc;
          }, []);
      }
      if (nouvPlages.length === 0) { const n = { ...prev }; delete n[propriDate]; return n; }
      return { ...prev, [propriDate]: nouvPlages };
    });
  }

  function supprimerPlage(date, idx) {
    setDisponibilites(prev => { const p = (prev[date] || []).filter((_, i) => i !== idx); if (!p.length) { const n = { ...prev }; delete n[date]; return n; } return { ...prev, [date]: p }; });
  }

  function resetSession() {
    setStep(1); setForm({ prenom: compteConnecte ? comptes[compteConnecte]?.prenom : "", nom: compteConnecte ? comptes[compteConnecte]?.nom : "", email: compteConnecte || "", telephone: compteConnecte ? comptes[compteConnecte]?.telephone : "", date: "", creneaux: [], adultes: 1, enfants12: 0, moins3: 0, reglementAccepte: false });
    setPhotosAvant([]); setPhotosApres([]); setPhotosCasse([]);
    setSignalementCasse(false); setDescriptionCasse("");
    setReservation(null); setNote(0); setCommentaire(""); setAvisEnvoye(false); setCodePromo(null);
    setCodePromoSaisi(""); setCodePromoStatut(null); setRemise(0);
    setExtrasChoisis({}); setModePaiement(null);
  }

  // ── HEADER ────────────────────────────────────────────────────────────────
  const STEP_LABELS = ["", "Calendrier & horaires", "Règlement", "Extras & paiement", "Paiement", "État arrivée", "Session en cours", "État départ"];
  function Header({ showSteps }) {
    return (
      <div style={{ background: "linear-gradient(160deg,#0B6E8A 0%,#1a9fbd 100%)" }}>
        <div style={{ padding: "18px 16px 4px", textAlign: "center" }}>
          <div style={{ fontSize: 28 }}>🏊</div>
          <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: 21, fontWeight: 700, color: "#fff", marginTop: 3 }}>Ma Piscine Privée</div>
          <div style={{ color: "#b8e8f0", fontSize: 12, marginTop: 1 }}>Écouflant • Maine-et-Loire</div>
          {(adminConnecte || proprioConnecte) && (
            <div style={{ marginTop:5, display:"flex", alignItems:"center", justifyContent:"center", gap:6, flexWrap:"wrap" }}>
              {adminConnecte && (
                <span style={{ background:"rgba(255,255,255,.15)", color:"#fff", fontSize:11, borderRadius:20, padding:"3px 10px" }}>
                  ⚙️ Admin connecté
                </span>
              )}
              {proprioConnecte && !adminConnecte && (
                <span style={{ background:"rgba(255,255,255,.15)", color:"#fff", fontSize:11, borderRadius:20, padding:"3px 10px" }}>
                  🔑 Propriétaire connecté
                </span>
              )}
              {modeMainenance && (
                <span style={{ background:"#FF6B6B", color:"#fff", fontSize:11, borderRadius:20, padding:"3px 10px", fontWeight:700 }}>
                  🔧 Maintenance ON
                </span>
              )}
            </div>
          )}
          {/* Alerte état des lieux */}
        {alerteEdl && (
          <div style={{ background: alerteEdl==="entree" ? "#4ECDC4" : "#FF6B6B", padding:"10px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
            <div>
              <div style={{ color:"#fff", fontWeight:700, fontSize:13 }}>
                {alerteEdl==="entree" ? "🏊 C'est l'heure ! Faites l'état des lieux d'entrée" : "⏰ Fin de session ! Faites l'état des lieux de sortie"}
              </div>
              <div style={{ color:"rgba(255,255,255,.8)", fontSize:11, marginTop:1 }}>
                Réservation {edlResaRef}
              </div>
            </div>
            <button onClick={() => {
              const resa = reservations.find(r => r.ref === edlResaRef);
              if (resa) {
                setReservation(resa);
                setMode(alerteEdl === "entree" ? "edlEntree" : "edlSortie");
                setAlerteEdl(null);
              }
            }} style={{ background:"rgba(255,255,255,.25)", border:"none", color:"#fff", borderRadius:8, padding:"6px 12px", fontWeight:700, fontSize:12, cursor:"pointer", flexShrink:0 }}>
              Commencer →
            </button>
          </div>
        )}
        {compteConnecte && (
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <span style={{ background: "rgba(255,255,255,.2)", color: "#fff", fontSize: 12, borderRadius: 20, padding: "3px 10px" }}>👤 {comptes[compteConnecte]?.prenom}</span>
              <button onClick={() => setMode("compte")} style={{ background: "rgba(255,255,255,.15)", color: "#fff", border: "none", borderRadius: 20, padding: "3px 10px", fontSize: 12, cursor: "pointer" }}>Mon compte</button>
            </div>
          )}
        </div>
        {showSteps && (
          <>
            <div style={{ display: "flex", justifyContent: "center", gap: 4, alignItems: "center", padding: "8px 16px 0" }}>
              {[1, 2, 3, 4, 5].map(n => (<div key={n} style={{ display: "flex", alignItems: "center", gap: 3 }}><StepDot n={n} active={step === n} done={step > n} />{n < 5 && <div style={{ width: 12, height: 2, background: step > n ? "#4ECDC4" : "rgba(255,255,255,.25)", borderRadius: 2 }} />}</div>))}
            </div>
            <div style={{ textAlign: "center", color: "#e0f4f8", fontSize: 11, paddingBottom: 5, paddingTop: 2 }}>{STEP_LABELS[Math.min(step, 7)]}</div>
          </>
        )}
        <Waves />
        {consentementCookies === null && !chargementInitial && (
          <div style={{ position:"fixed", left:0, right:0, bottom:0, zIndex:2000, background:"#fff", boxShadow:"0 -4px 20px rgba(0,0,0,.15)", padding:"16px", borderRadius:"16px 16px 0 0" }}>
            <div style={{ fontSize:13, color:"#2C3E50", lineHeight:1.6, marginBottom:12 }}>
              🍪 Cette application utilise uniquement des cookies techniques nécessaires à son fonctionnement (connexion, préférences de réservation). Aucun cookie publicitaire n'est utilisé.{" "}
              <span onClick={() => { setModeOrigineAvantLegal(mode); setMode("confidentialite"); }} style={{ color:"#0B6E8A", fontWeight:700, cursor:"pointer", textDecoration:"underline" }}>En savoir plus</span>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => repondreConsentement(true)} style={{ flex:1, padding:"10px", borderRadius:9, background:"linear-gradient(135deg,#0B6E8A,#4ECDC4)", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                Accepter
              </button>
              <button onClick={() => repondreConsentement(false)} style={{ flex:1, padding:"10px", borderRadius:9, background:"#fff", color:"#0B6E8A", border:"1.5px solid #0B6E8A", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                Refuser
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── ÉCRAN DE CHARGEMENT INITIAL ───────────────────────────────────────────
  if (chargementInitial) return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#F7F0E6", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:14, animation:"pulse 1.5s infinite" }}>🏊</div>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, color:"#0B6E8A", fontWeight:700 }}>Chargement...</div>
        <style>{`@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }`}</style>
      </div>
    </div>
  );

  if (erreurChargement) return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#F7F0E6", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ textAlign:"center", maxWidth:340 }}>
        <div style={{ fontSize:48, marginBottom:14 }}>⚠️</div>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, color:"#FF6B6B", fontWeight:700, marginBottom:10 }}>Connexion impossible</div>
        <div style={{ fontSize:13, color:"#5a8a96", lineHeight:1.6, marginBottom:16 }}>Impossible de charger les données. Vérifiez votre connexion internet et réessayez.</div>
        <button onClick={() => window.location.reload()} style={{ background:"linear-gradient(135deg,#0B6E8A,#4ECDC4)", color:"#fff", border:"none", borderRadius:10, padding:"12px 24px", fontSize:14, fontWeight:700, cursor:"pointer" }}>Réessayer</button>
      </div>
    </div>
  );


  // ── PAGE ANNONCE PUBLIQUE ────────────────────────────────────────────────
  if (mode === "annonce") return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#F7F0E6", minHeight:"100vh" }}>
      <Header showSteps={false}/>
      <div style={{ padding:"0 0 32px" }}>
        {/* Galerie photos */}
        {annonce.photos.length > 0 ? (
          <div style={{ position:"relative", height:240, overflow:"hidden", background:"#0B6E8A" }}>
            <img src={annonce.photos[photoAffichee] || annonce.photos[0]} alt="piscine"
              style={{ width:"100%", height:"100%", objectFit:"cover", opacity:.9 }}/>
            {annonce.photos.length > 1 && (
              <>
                {/* Flèche gauche */}
                <button onClick={() => setPhotoAffichee(i => (i - 1 + annonce.photos.length) % annonce.photos.length)}
                  style={{ position:"absolute", left:8, top:"50%", transform:"translateY(-50%)", background:"rgba(0,0,0,.4)", color:"#fff", border:"none", borderRadius:"50%", width:36, height:36, fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
                {/* Flèche droite */}
                <button onClick={() => setPhotoAffichee(i => (i + 1) % annonce.photos.length)}
                  style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"rgba(0,0,0,.4)", color:"#fff", border:"none", borderRadius:"50%", width:36, height:36, fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
                {/* Points de pagination */}
                <div style={{ position:"absolute", bottom:12, left:0, right:0, display:"flex", justifyContent:"center", gap:6 }}>
                  {annonce.photos.map((_, i) => (
                    <div key={i} onClick={() => setPhotoAffichee(i)}
                      style={{ width:7, height:7, borderRadius:"50%", background: i===photoAffichee ? "#fff" : "rgba(255,255,255,.4)", cursor:"pointer" }}/>
                  ))}
                </div>
                {/* Badge nombre de photos, cliquable pour la grille complète */}
                <div onClick={() => setGalerieOuverte(true)}
                  style={{ position:"absolute", bottom:10, right:10, background:"rgba(0,0,0,.5)", color:"#fff", borderRadius:20, padding:"4px 12px", fontSize:12, cursor:"pointer" }}>
                  📷 {photoAffichee + 1}/{annonce.photos.length}
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ height:180, background:"linear-gradient(160deg,#0B6E8A,#4ECDC4)", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" }}>
            <div style={{ fontSize:48 }}>🏊</div>
            <div style={{ color:"rgba(255,255,255,.7)", fontSize:13, marginTop:4 }}>Photos à venir</div>
          </div>
        )}

        {/* Galerie plein écran (grille de toutes les photos) */}
        {galerieOuverte && (
          <div onClick={() => setGalerieOuverte(false)}
            style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.92)", zIndex:1000, display:"flex", flexDirection:"column", padding:"16px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <span style={{ color:"#fff", fontWeight:700, fontSize:15 }}>📷 {annonce.photos.length} photos</span>
              <button onClick={() => setGalerieOuverte(false)} style={{ background:"rgba(255,255,255,.15)", color:"#fff", border:"none", borderRadius:"50%", width:34, height:34, fontSize:18, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ flex:1, overflowY:"auto", display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }} onClick={e => e.stopPropagation()}>
              {annonce.photos.map((url, i) => (
                <img key={i} src={url} alt="" onClick={() => { setPhotoAffichee(i); setGalerieOuverte(false); }}
                  style={{ width:"100%", height:140, objectFit:"cover", borderRadius:10, cursor:"pointer", border: i===photoAffichee ? "3px solid #4ECDC4" : "none" }}/>
              ))}
            </div>
          </div>
        )}


        <div style={{ padding:"16px 16px 0" }}>
          {/* Titre + statut */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, fontWeight:700, color:"#2C3E50", lineHeight:1.3, flex:1 }}>
              {annonce.titre}
            </div>
            {!annonce.ouvert && (
              <div style={{ background:"#ffd6d6", color:"#c0302a", borderRadius:8, padding:"3px 10px", fontSize:11, fontWeight:700, flexShrink:0, marginLeft:8 }}>
                ✗ Fermée
              </div>
            )}
          </div>

          {/* Infos rapides */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:14 }}>
            {[["📍", `${annonce.ville}`],["💧","11m × 5m"],["🌡️","Chauffée 28°C"],["👥",`Max ${annonce.capaciteMax} pers.`],
              ["👁️", annonce.visAVis==="aucun"?"Aucun vis-à-vis":annonce.visAVis==="leger"?"Vis-à-vis léger":"Vis-à-vis complet"],
              ["🧴", annonce.produitEntretien.charAt(0).toUpperCase()+annonce.produitEntretien.slice(1)],
            ].map(([icon,text])=>(
              <div key={text} style={{ display:"flex", alignItems:"center", gap:4, background:"#fff", borderRadius:20, padding:"4px 10px", fontSize:12, fontWeight:600, color:"#2C3E50", border:"1px solid #e0e0e0" }}>
                <span>{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>

          {/* Tarif */}
          <div style={{ background:"linear-gradient(135deg,#0B6E8A,#4ECDC4)", borderRadius:12, padding:"12px 16px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ color:"#b8e8f0", fontSize:12 }}>À partir de</div>
              <div style={{ color:"#fff", fontWeight:700, fontSize:22, fontFamily:"'Playfair Display',serif" }}>{TARIF_BASE} €<span style={{ fontSize:13, fontWeight:400 }}>/pers/h</span></div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ color:"#ffe082", fontSize:12 }}>🌙 Soirée (après 20h)</div>
              <div style={{ color:"#fff", fontWeight:600, fontSize:14 }}>{TARIF_BASE+TARIF_SOIREE} €/pers/h</div>
            </div>
          </div>

          {/* Description */}
          <div style={{ ...card, marginBottom:14 }}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", fontWeight:700, marginBottom:10 }}>À propos</div>
            <div style={{ fontSize:13, color:"#2C3E50", lineHeight:1.8, whiteSpace:"pre-line" }}>{annonce.description}</div>
          </div>

          {/* Équipements */}
          <div style={{ ...card, marginBottom:14 }}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", fontWeight:700, marginBottom:12 }}>🧰 Équipements</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {Object.entries(annonce.equipements).filter(([,v])=>v).map(([k])=>{
                const [emoji,label] = EQUIPEMENTS_LABELS[k]||["✓",k];
                return (
                  <div key={k} style={{ display:"flex", alignItems:"center", gap:5, background:"#e6faf8", borderRadius:20, padding:"5px 12px", fontSize:12, fontWeight:600, color:"#0B6E8A" }}>
                    {emoji} {label}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Règlement */}
          <div style={{ ...card, marginBottom:14 }}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", fontWeight:700, marginBottom:12 }}>📋 Règlement</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {[["enfants","👶","Enfants 0-12 ans"],["naturisme","🧘","Naturisme"],["burkini","👙","Burkini"],
                ["evenements","🎉","Événements"],["alcool","🍷","Alcool"],["fumeur","🚬","Fumeur"],
                ["animaux","🐾","Animaux"],["musique","🎵","Musique"]].map(([k,emoji,label])=>(
                <div key={k} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12 }}>
                  <span style={{ fontSize:16 }}>{emoji}</span>
                  <span style={{ color:"#2C3E50", fontWeight:600 }}>{label}</span>
                  <span style={{ marginLeft:"auto", color:annonce.reglement[k]?"#4ECDC4":"#FF6B6B", fontWeight:700, fontSize:14 }}>
                    {annonce.reglement[k]?"✓":"✗"}
                  </span>
                </div>
              ))}
            </div>
            {annonce.precisions && annonce.precisions.length > 0 && (
              <div style={{ marginTop:12, background:"#f0fafc", borderRadius:8, padding:"12px", border:"1px solid #b0d8e3", maxHeight:240, overflowY:"auto" }}>
                {annonce.precisions.map(p => (
                  <div key={p.id} style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:8, fontSize:12, color:"#2C3E50", lineHeight:1.5 }}>
                    <span style={{ flexShrink:0 }}>{p.emoji}</span>
                    <span>{p.texte}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dispositifs sécurité */}
          <div style={{ ...card, marginBottom:14 }}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, color:"#0B6E8A", fontWeight:700, marginBottom:10 }}>🛡️ Dispositifs de sécurité</div>
            <div style={{ fontSize:12, color:"#5a8a96", marginBottom:8 }}>Conformité loi du 03/01/2003 :</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {[["barriere","🚧","Barrière de protection"],["bache","🟦","Bâche de sécurité"],
                ["abri","🏠","Abri de piscine"],["alarme","🔔","Alarme de sécurité"]].map(([k,emoji,label])=>(
                <div key={k} style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600, background:annonce.dispositifs[k]?"#e6faf8":"#f5f5f5", color:annonce.dispositifs[k]?"#0B6E8A":"#bbb", border:`1px solid ${annonce.dispositifs[k]?"#4ECDC4":"#e0e0e0"}` }}>
                  {emoji} {label} {annonce.dispositifs[k]&&"✓"}
                </div>
              ))}
            </div>
          </div>

          {annonce.ouvert && (
            <button style={btnP} onClick={() => { setMode("locataire"); setStep(1); }}>
              🏊 Réserver maintenant
            </button>
          )}
          <button style={btnS} onClick={() => setMode("accueil")}>← Retour</button>
        </div>
      </div>
    </div>
  );

  // ── PAGES LÉGALES (Politique de confidentialité & CGU) ───────────────────
  if (mode === "confidentialite" || mode === "cgu") return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:19, color:"#0B6E8A", fontWeight:700, marginBottom:14 }}>
            {mode === "confidentialite" ? "🔒 Politique de confidentialité" : "📜 Conditions générales d'utilisation"}
          </div>
          <div style={{ background:"#f0fafc", borderRadius:10, padding:"14px 16px", fontSize:13, color:"#2C3E50", lineHeight:1.7, whiteSpace:"pre-line", border:"1px solid #b0d8e3", maxHeight:480, overflowY:"auto" }}>
            {mode === "confidentialite" ? POLITIQUE_CONFIDENTIALITE : CGU_TEXTE}
          </div>
        </div>
        <button style={btnS} onClick={() => setMode(modeOrigineAvantLegal)}>← Retour</button>
      </div>
    </div>
  );

  // ── PAGE ACCUEIL ──────────────────────────────────────────────────────────
  if (mode === "accueil") return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "#5a8a96", marginBottom: 18, lineHeight: 1.6 }}>Bienvenue ! Réservez notre piscine privée ou gérez vos disponibilités.</div>
          <button style={btnP} onClick={() => setMode("annonce")}>🏊 Voir l'annonce & Réserver</button>
          {!compteConnecte ? (
            <button style={{ ...btnS, marginTop: 10 }} onClick={() => { setAuthMode("login"); setMode("auth"); }}>👤 Se connecter / Créer un compte</button>
          ) : (
            <button style={{ ...btnS, marginTop: 10 }} onClick={() => setMode("compte")}>📋 Mon compte & réservations</button>
          )}
          <button style={{ ...btnS, marginTop: 10, borderColor: "#0B6E8A", color: "#0B6E8A" }} onClick={() => setMode(proprioConnecte || adminConnecte ? "proprio" : "loginProprio")}>🔑 Espace propriétaire</button>
          <button style={{ ...btnS, marginTop: 10, borderColor: "#aaa", color: "#888", fontSize:12, padding:"8px 24px" }} onClick={() => setMode(adminConnecte ? "proprio" : "loginAdmin")}>⚙️ Accès administrateur</button>
        </div>
        {(proprioConnecte || adminConnecte) && (
          <div style={card}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, color: "#0B6E8A", marginBottom: 4, fontWeight: 700 }}>Infos pratiques</div>
            <div style={{ fontSize: 11, color: "#aaa", marginBottom: 10 }}>Visible uniquement par vous, aide-mémoire</div>
            {[["💧", "Piscine privée", "Accès exclusif pendant votre créneau"], ["👥", "Tarifs", "9 €/pers/h · -50% enfants 3–11 ans · gratuit -3 ans"], ["⏱️", "Créneaux", "Choisissez librement vos horaires"], ["🧹", "Nettoyage", "1h de battement automatique entre chaque location"]].map(([icon, title, desc]) => (
              <div key={title} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 19 }}>{icon}</span>
                <div><div style={{ fontWeight: 600, fontSize: 13, color: "#2C3E50" }}>{title}</div><div style={{ fontSize: 12, color: "#5a8a96" }}>{desc}</div></div>
              </div>
            ))}
          </div>
        )}
        <div style={{ textAlign:"center", marginTop:18, fontSize:11, color:"#aaa" }}>
          <span onClick={() => { setModeOrigineAvantLegal("accueil"); setMode("confidentialite"); }} style={{ cursor:"pointer", textDecoration:"underline" }}>Confidentialité</span>
          {" · "}
          <span onClick={() => { setModeOrigineAvantLegal("accueil"); setMode("cgu"); }} style={{ cursor:"pointer", textDecoration:"underline" }}>CGU</span>
        </div>
      </div>
    </div>
  );

  // ── PAGE AUTH ─────────────────────────────────────────────────────────────
  if (mode === "auth") return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={{ display: "flex", gap: 0, marginBottom: 14, background: "#e8f4f7", borderRadius: 10, padding: 4 }}>
          {[["login", "Se connecter"], ["register", "Créer un compte"]].map(([v, label]) => (
            <button key={v} onClick={() => { setAuthMode(v); setAuthErreur(""); }} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", background: authMode === v ? "#0B6E8A" : "transparent", color: authMode === v ? "#fff" : "#0B6E8A", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{label}</button>
          ))}
        </div>
        <div style={card}>
          {authMode === "register" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div><label style={lbl}>Prénom</label><input style={inp} value={authForm.prenom} onChange={e => setAuthForm(f => ({ ...f, prenom: e.target.value }))} /></div>
              <div><label style={lbl}>Nom</label><input style={inp} value={authForm.nom} onChange={e => setAuthForm(f => ({ ...f, nom: e.target.value }))} /></div>
            </div>
          )}
          {authMode === "register" && (
            <div style={{ marginBottom: 10 }}><label style={lbl}>Téléphone</label><input style={inp} type="tel" value={authForm.telephone} onChange={e => setAuthForm(f => ({ ...f, telephone: e.target.value }))} /></div>
          )}
          {authMode === "register" && (
            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>Adresse</label>
              <input style={inp} placeholder="N° et nom de rue" value={authForm.adresse} onChange={e => setAuthForm(f => ({ ...f, adresse: e.target.value }))} />
            </div>
          )}
          {authMode === "register" && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={lbl}>Code postal</label>
                <input style={inp} placeholder="49000" maxLength={5} value={authForm.codePostal} onChange={e => setAuthForm(f => ({ ...f, codePostal: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Ville</label>
                <input style={inp} placeholder="Angers" value={authForm.ville} onChange={e => setAuthForm(f => ({ ...f, ville: e.target.value }))} />
              </div>
            </div>
          )}
          {authMode === "register" && (
            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>Adresse *</label>
              <input style={inp} placeholder="N° et nom de rue" value={authForm.adresse} onChange={e => setAuthForm(f => ({ ...f, adresse: e.target.value }))} />
            </div>
          )}
          {authMode === "register" && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={lbl}>Code postal *</label>
                <input style={inp} placeholder="49000" maxLength={5} value={authForm.codePostal} onChange={e => setAuthForm(f => ({ ...f, codePostal: e.target.value.replace(/\D/g,"") }))} />
              </div>
              <div>
                <label style={lbl}>Ville *</label>
                <input style={inp} placeholder="Angers" value={authForm.ville} onChange={e => setAuthForm(f => ({ ...f, ville: e.target.value }))} />
              </div>
            </div>
          )}
          <div style={{ marginBottom: 10 }}><label style={lbl}>Email</label><input style={inp} type="email" value={authForm.email} onChange={e => setAuthForm(f => ({ ...f, email: e.target.value }))} /></div>
          <div style={{ marginBottom: 10 }}><label style={lbl}>Mot de passe</label><input style={inp} type="password" value={authForm.motdepasse} onChange={e => setAuthForm(f => ({ ...f, motdepasse: e.target.value }))} /></div>
          {authMode === "register" && (
            <div style={{ marginBottom: 10 }}><label style={lbl}>Confirmer le mot de passe</label><input style={inp} type="password" value={authForm.motdepasse2} onChange={e => setAuthForm(f => ({ ...f, motdepasse2: e.target.value }))} /></div>
          )}
          {authMode === "register" && (
            <label style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:14, cursor:"pointer" }}>
              <input type="checkbox" checked={authForm.cguAcceptees||false} onChange={e=>setAuthForm(f=>({...f,cguAcceptees:e.target.checked}))} style={{ marginTop:2, width:16, height:16, accentColor:"#0B6E8A" }}/>
              <span style={{ fontSize:12, color:"#5a8a96", lineHeight:1.5 }}>
                J'accepte les{" "}
                <span onClick={e=>{e.preventDefault();e.stopPropagation();setModeOrigineAvantLegal("auth");setMode("cgu");}} style={{ color:"#0B6E8A", fontWeight:600, textDecoration:"underline" }}>CGU</span>
                {" "}et la{" "}
                <span onClick={e=>{e.preventDefault();e.stopPropagation();setModeOrigineAvantLegal("auth");setMode("confidentialite");}} style={{ color:"#0B6E8A", fontWeight:600, textDecoration:"underline" }}>politique de confidentialité</span>
              </span>
            </label>
          )}
          {authErreur && <div style={{ color: "#FF6B6B", fontSize: 13, marginBottom: 8, padding: "8px 10px", background: "#fff0f0", borderRadius: 8 }}>{authErreur}</div>}
          <button style={{ ...btnP, opacity: (authMode === "register" && !authForm.cguAcceptees) ? .5 : 1 }} disabled={authMode === "register" && !authForm.cguAcceptees} onClick={authMode === "login" ? connecter : inscrire}>
            {authMode === "login" ? "Se connecter" : "Créer mon compte"}
          </button>
        </div>
        <button style={btnS} onClick={() => setMode("accueil")}>← Accueil</button>
      </div>
    </div>
  );

  // ── PAGE COMPTE LOCATAIRE ─────────────────────────────────────────────────
  if (mode === "compte") {
    const compte = comptes[compteConnecte];
    const mesRes = reservations.filter(r => compte?.reservations?.includes(r.ref)).sort((a, b) => b.date.localeCompare(a.date));
    const [factureOuverte, setFactureOuverte] = useState(null);
    return (
      <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
        <Header showSteps={false} />
        <div style={{ padding: "16px 16px 32px" }}>
          <div style={card}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#0B6E8A", fontWeight: 700, marginBottom: 12 }}>👤 Mon compte</div>
            <div style={{ fontSize: 14, color: "#2C3E50", lineHeight: 2 }}>
              <strong>{compte?.prenom} {compte?.nom}</strong><br />
              📧 {compte?.email}<br />
              📞 {compte?.telephone}<br />
              {compte?.adresse && <>{compte.adresse}<br /></>}
              {(compte?.codePostal || compte?.ville) && <span style={{color:"#5a8a96"}}>📍 {compte?.codePostal} {compte?.ville}</span>}
            </div>
          </div>
          <div style={card}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#0B6E8A", fontWeight: 700, marginBottom: 12 }}>📋 Mes réservations</div>
            {mesRes.length === 0 ? (
              <div style={{ color: "#5a8a96", fontSize: 14, textAlign: "center", padding: "16px 0" }}>Aucune réservation pour l'instant.</div>
            ) : mesRes.map(r => {
              const noteP = notesLocataires[r.ref];
              const showFacture = factureOuverte === r.ref;
              const extrasRes = extras.filter(e => r.extrasChoisis?.[e.id]);
              return (
                <div key={r.ref} style={{ background: "#f0fafc", borderRadius: 10, padding: "12px 14px", marginBottom: 10, border: "1px solid #b0d8e3" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#0B6E8A", fontSize: 13 }}>{r.ref}</div>
                      <div style={{ fontSize: 12, color: "#5a8a96" }}>{r.date} · {padH(r.heureDebut ?? parseInt(r.heureDebut))} → {padH(r.heureFin ?? parseInt(r.heureFin))}</div>
                      <div style={{ fontSize: 12, color: "#5a8a96" }}>{r.adultes} adulte{r.adultes > 1 ? "s" : ""}{r.enfants12 > 0 ? ` + ${r.enfants12} enfant` : ""} · {formatEur(r.totalGeneral || r.prix)}</div>
                    </div>
                    <div style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: r.date >= today() ? "#e6faf8" : "#f0f0f0", color: r.date >= today() ? "#0B6E8A" : "#888", fontWeight: 600 }}>
                      {r.date >= today() ? "À venir" : "Passée"}
                    </div>
                  </div>
                  {r.statut === "acceptee" && r.date === today() && (
                    <div style={{ display:"flex", gap:8, marginTop:10 }}>
                      {!r.edlEntreeFait && (
                        <button onClick={() => { setReservation(r); setMode("edlEntree"); }}
                          style={{ flex:1, padding:"9px", borderRadius:8, background:"#4ECDC4", color:"#fff", border:"none", fontWeight:700, fontSize:12, cursor:"pointer" }}>
                          📷 État des lieux d'entrée
                        </button>
                      )}
                      {r.edlEntreeFait && !r.edlSortieFait && (
                        <button onClick={() => { setReservation(r); setMode("edlSortie"); }}
                          style={{ flex:1, padding:"9px", borderRadius:8, background:"#FF6B6B", color:"#fff", border:"none", fontWeight:700, fontSize:12, cursor:"pointer" }}>
                          📷 État des lieux de sortie
                        </button>
                      )}
                      {r.edlEntreeFait && r.edlSortieFait && (
                        <div style={{ flex:1, padding:"9px", borderRadius:8, background:"#e6faf8", color:"#0B6E8A", textAlign:"center", fontWeight:600, fontSize:12 }}>
                          ✓ États des lieux complétés
                        </div>
                      )}
                    </div>
                  )}
                  {r.note && <div style={{ fontSize: 12, color: "#f0a500", marginTop: 4 }}>Votre avis : {"⭐".repeat(r.note)}</div>}
                  {noteP && (
                    <div style={{ fontSize: 12, marginTop: 4, color: noteP.note >= 4 ? "#0B6E8A" : "#888" }}>
                      Note propriétaire : {"⭐".repeat(noteP.note)}
                      {r.codePromo && <span style={{ color: "#4ECDC4", marginLeft: 6, fontWeight: 600 }}>✓ Code promo reçu : {r.codePromo.code}</span>}
                    </div>
                  )}
                  {/* Bouton facture */}
                  <button onClick={() => setFactureOuverte(showFacture ? null : r.ref)}
                    style={{ marginTop:10, width:"100%", padding:"8px", borderRadius:8, background:showFacture?"#e8f4f7":"#0B6E8A", color:showFacture?"#0B6E8A":"#fff", border:showFacture?"1.5px solid #0B6E8A":"none", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                    {showFacture ? "▲ Masquer la facture" : "🧾 Voir la facture / ticket"}
                  </button>
                  {/* Facture dépliable */}
                  {showFacture && (
                    <div style={{ marginTop:10, background:"#fff", borderRadius:10, padding:"16px", border:"2px solid #0B6E8A" }}>
                      <div style={{ textAlign:"center", marginBottom:12 }}>
                        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, fontWeight:700, color:"#0B6E8A" }}>🏊 Ma Piscine Privée</div>
                        <div style={{ fontSize:11, color:"#5a8a96" }}>Écouflant · Maine-et-Loire</div>
                        <div style={{ height:1, background:"#0B6E8A", margin:"8px 0" }}/>
                        <div style={{ fontSize:14, fontWeight:700, color:"#2C3E50", letterSpacing:.5 }}>FACTURE</div>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10, fontSize:11, fontFamily:"monospace" }}>
                        <div><span style={{ color:"#5a8a96" }}>N° facture</span><br/><strong>{r.ref}</strong></div>
                        <div><span style={{ color:"#5a8a96" }}>Émise le</span><br/><strong>{new Date().toLocaleDateString("fr-FR")}</strong></div>
                        <div style={{ marginTop:4 }}><span style={{ color:"#5a8a96" }}>Client</span><br/><strong>{r.prenom} {r.nom}</strong></div>
                        <div style={{ marginTop:4 }}><span style={{ color:"#5a8a96" }}>Session du</span><br/><strong>{r.date}</strong></div>
                      </div>
                      <div style={{ height:1, background:"#e0e0e0", margin:"8px 0" }}/>
                      <div style={{ fontSize:11, fontFamily:"monospace", marginBottom:8 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontWeight:700, color:"#5a8a96", marginBottom:5, fontSize:10 }}>
                          <span>DÉSIGNATION</span><span>MONTANT</span>
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                          <div>
                            <div style={{ fontWeight:600 }}>Location piscine privée</div>
                            <div style={{ fontSize:10, color:"#5a8a96" }}>{padH(r.heureDebut)} → {padH(r.heureFin)} · {r.adultes} adulte{r.adultes>1?"s":""}{r.enfants12>0?` + ${r.enfants12} enfant`:""}{r.moins3>0?` + ${r.moins3} bébé`:""}</div>
                            {r.creneaux?.some(h=>h>=20) && <div style={{ fontSize:10, color:"#a06000" }}>🌙 Majoration soirée incluse</div>}
                          </div>
                          <span style={{ fontWeight:600 }}>{formatEur(r.prix)}</span>
                        </div>
                        {extrasRes.map(e => {
                          const qte = r.extrasChoisis?.[e.id] || 0;
                          const nb = e.type==="personne" ? qte : 1;
                          return (
                            <div key={e.id} style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                              <div>
                                <div style={{ fontWeight:600 }}>{e.emoji} {e.nom}</div>
                                <div style={{ fontSize:10, color:"#5a8a96" }}>{e.type==="personne"?`${e.tarif}€ × ${nb}`:"Forfait"}</div>
                              </div>
                              <span style={{ fontWeight:600 }}>{formatEur(e.tarif*nb)}</span>
                            </div>
                          );
                        })}
                        {r.remise > 0 && (
                          <div style={{ display:"flex", justifyContent:"space-between", color:"#4ECDC4", marginBottom:4 }}>
                            <span>Code promo -{r.remise}%</span>
                            <span>-{formatEur(r.prix*(r.remise/100))}</span>
                          </div>
                        )}
                      </div>
                      <div style={{ height:1, background:"#0B6E8A", margin:"6px 0" }}/>
                      <div style={{ display:"flex", justifyContent:"space-between", fontWeight:700, fontSize:15, marginBottom:6, fontFamily:"monospace" }}>
                        <span>TOTAL</span>
                        <span style={{ color:"#0B6E8A" }}>{formatEur(r.totalGeneral||r.prix)}</span>
                      </div>
                      <div style={{ fontSize:11, color:"#5a8a96", fontFamily:"monospace", marginBottom:2 }}>
                        Mode : {r.modePaiement==="especes"?"Espèces (acompte 20% en ligne)":"Carte bancaire"}
                      </div>
                      {r.modePaiement==="especes" && (
                        <div style={{ fontSize:11, fontFamily:"monospace" }}>
                          <div style={{ display:"flex", justifyContent:"space-between" }}>
                            <span style={{ color:"#5a8a96" }}>Acompte réglé</span>
                            <span style={{ fontWeight:600, color:"#4ECDC4" }}>{formatEur(r.acompte)} ✓</span>
                          </div>
                          <div style={{ display:"flex", justifyContent:"space-between" }}>
                            <span style={{ color:"#5a8a96" }}>Reste en espèces</span>
                            <span style={{ fontWeight:600, color:"#FF6B6B" }}>{formatEur(r.resteARegler)}</span>
                          </div>
                        </div>
                      )}
                      <div style={{ height:1, background:"#e0e0e0", margin:"10px 0" }}/>
                      <div style={{ textAlign:"center", fontSize:10, color:"#aaa", lineHeight:1.7 }}>
                        Document non soumis à TVA · Prestataire individuel<br/>
                        Merci de votre confiance — Ma Piscine Privée 🏊
                      </div>
                      <button onClick={() => window.print()} style={{ marginTop:10, width:"100%", padding:"8px", borderRadius:8, background:"#f0fafc", color:"#0B6E8A", border:"1.5px solid #0B6E8A", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                        🖨️ Imprimer / Enregistrer en PDF
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button style={{ ...btnS, borderColor: "#FF6B6B", color: "#FF6B6B", marginTop: 8 }} onClick={deconnecter}>Se déconnecter</button>

          {/* Droit à l'effacement RGPD */}
          {!confirmationSuppression ? (
            <button onClick={() => setConfirmationSuppression(true)}
              style={{ background:"none", border:"none", color:"#aaa", fontSize:12, textDecoration:"underline", cursor:"pointer", marginTop:14, width:"100%", textAlign:"center" }}>
              🗑 Supprimer mon compte et mes données
            </button>
          ) : (
            <div style={{ marginTop:14, background:"#fff0f0", borderRadius:10, padding:"14px", border:"2px solid #FF6B6B" }}>
              <div style={{ fontWeight:700, color:"#c0302a", fontSize:13, marginBottom:6 }}>⚠️ Confirmer la suppression</div>
              <div style={{ fontSize:12, color:"#2C3E50", lineHeight:1.6, marginBottom:10 }}>
                Cette action supprimera définitivement votre compte et vos coordonnées. Vos réservations passées resteront archivées à des fins comptables, mais ne seront plus liées à un compte actif. Cette action est irréversible.
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={supprimerMonCompte} style={{ flex:1, padding:"9px", borderRadius:8, background:"#FF6B6B", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                  Oui, supprimer
                </button>
                <button onClick={() => setConfirmationSuppression(false)} style={{ ...btnS, marginTop:0, fontSize:13, padding:"9px" }}>
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── PAGE LOGIN ADMIN ─────────────────────────────────────────────────────────
  if (mode === "loginAdmin") return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#F7F0E6", minHeight:"100vh" }}>
      <div style={{ background:"linear-gradient(160deg,#0B6E8A 0%,#1a9fbd 100%)", paddingBottom:0 }}>
        <div style={{ padding:"28px 16px 8px", textAlign:"center" }}>
          <div style={{ fontSize:32 }}>🔑</div>
          <div style={{ fontFamily:"'Playfair Display',Georgia,serif", fontSize:22, fontWeight:700, color:"#fff", marginTop:4 }}>Espace propriétaire</div>
          <div style={{ color:"#b8e8f0", fontSize:12, marginTop:2 }}>Accès réservé</div>
        </div>
        <Waves/>
      </div>
      <div style={{ padding:"24px 16px 32px" }}>
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(11,110,138,.10)", padding:"24px 20px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:19, color:"#0B6E8A", fontWeight:700, marginBottom:16 }}>Connexion administrateur</div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Email</label>
            <input type="email" style={{ width:"100%", padding:"11px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }}
              value={authAdmin.email} onChange={e=>setAuthAdmin(a=>({...a,email:e.target.value}))}
              placeholder="votre@email.fr"/>
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Mot de passe</label>
            <input type="password" style={{ width:"100%", padding:"11px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }}
              value={authAdmin.password} onChange={e=>setAuthAdmin(a=>({...a,password:e.target.value}))}
              onKeyDown={e=>e.key==="Enter"&&connecterAdmin()}
              placeholder="••••••••"/>
          </div>
          {erreurAdmin && (
            <div style={{ background:"#fff0f0", border:"1px solid #FF6B6B", borderRadius:8, padding:"10px 12px", color:"#c0302a", fontSize:13, marginBottom:12 }}>
              ❌ {erreurAdmin}
            </div>
          )}
          <button style={{ background:"linear-gradient(135deg,#0B6E8A,#4ECDC4)", color:"#fff", border:"none", borderRadius:10, padding:"13px 24px", fontSize:15, fontWeight:700, cursor:"pointer", width:"100%", marginBottom:10 }}
            onClick={connecterAdmin}>
            Se connecter
          </button>
        </div>
        <button style={{ background:"transparent", color:"#0B6E8A", border:"2px solid #0B6E8A", borderRadius:10, padding:"11px 24px", fontSize:14, fontWeight:600, cursor:"pointer", width:"100%" }}
          onClick={()=>setMode("accueil")}>← Accueil</button>
      </div>
    </div>
  );

  // ── PAGE LOGIN PROPRIÉTAIRE ──────────────────────────────────────────────────
  if (mode === "loginProprio") return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#F7F0E6", minHeight:"100vh" }}>
      <div style={{ background:"linear-gradient(160deg,#0B6E8A 0%,#1a9fbd 100%)", paddingBottom:0 }}>
        <div style={{ padding:"28px 16px 8px", textAlign:"center" }}>
          <div style={{ fontSize:32 }}>🏊</div>
          <div style={{ fontFamily:"'Playfair Display',Georgia,serif", fontSize:22, fontWeight:700, color:"#fff", marginTop:4 }}>Espace propriétaire</div>
          <div style={{ color:"#b8e8f0", fontSize:12, marginTop:2 }}>Gérez votre annonce et vos réservations</div>
        </div>
        <Waves/>
      </div>
      <div style={{ padding:"24px 16px 32px" }}>
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(11,110,138,.10)", padding:"24px 20px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:19, color:"#0B6E8A", fontWeight:700, marginBottom:16 }}>Connexion propriétaire</div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Email</label>
            <input type="email" style={{ width:"100%", padding:"11px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }}
              value={authProprio.email} onChange={e=>setAuthProprio(a=>({...a,email:e.target.value}))}
              placeholder="votre@email.fr"/>
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:4, display:"block" }}>Mot de passe</label>
            <input type="password" style={{ width:"100%", padding:"11px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box" }}
              value={authProprio.password} onChange={e=>setAuthProprio(a=>({...a,password:e.target.value}))}
              onKeyDown={e=>e.key==="Enter"&&connecterProprio()}
              placeholder="••••••••"/>
          </div>
          {erreurProprio && (
            <div style={{ background:"#fff0f0", border:"1px solid #FF6B6B", borderRadius:8, padding:"10px 12px", color:"#c0302a", fontSize:13, marginBottom:12 }}>
              ❌ {erreurProprio}
            </div>
          )}
          <button style={{ background:"linear-gradient(135deg,#0B6E8A,#4ECDC4)", color:"#fff", border:"none", borderRadius:10, padding:"13px 24px", fontSize:15, fontWeight:700, cursor:"pointer", width:"100%", marginBottom:10 }}
            onClick={connecterProprio}>
            Se connecter
          </button>
        </div>
        <button style={{ background:"transparent", color:"#0B6E8A", border:"2px solid #0B6E8A", borderRadius:10, padding:"11px 24px", fontSize:14, fontWeight:600, cursor:"pointer", width:"100%" }}
          onClick={()=>setMode("accueil")}>← Accueil</button>
      </div>
    </div>
  );

  // ── PAGE MAINTENANCE (vue locataires) ─────────────────────────────────────
  if (modeMainenance && !adminConnecte && !proprioConnecte && mode !== "loginAdmin" && mode !== "loginProprio") return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#F7F0E6", minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"32px 24px" }}>
      <div style={{ textAlign:"center", maxWidth:360 }}>
        <div style={{ fontSize:64, marginBottom:16 }}>🔧</div>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:24, fontWeight:700, color:"#0B6E8A", marginBottom:12 }}>
          Maintenance en cours
        </div>
        <div style={{ fontSize:15, color:"#5a8a96", lineHeight:1.7, marginBottom:28, background:"#fff", borderRadius:14, padding:"16px 20px", boxShadow:"0 4px 20px rgba(11,110,138,.08)" }}>
          {messageMainenance}
        </div>
        <div style={{ fontSize:13, color:"#aaa" }}>
          Merci de votre patience 🙏
        </div>
        {/* Lien discret pour le propriétaire */}
        <div style={{ marginTop:40 }}>
          <span onClick={()=>setMode("loginAdmin")} style={{ fontSize:11, color:"#ccc", cursor:"pointer", textDecoration:"underline" }}>
            Accès propriétaire
          </span>
        </div>
      </div>
    </div>
  );

  // Redirection proprio si non connecté (admin a aussi le droit d'entrer en mode "supervision")
  if (mode === "proprio" && !proprioConnecte && !adminConnecte) {
    setMode("loginProprio");
    return null;
  }

  // ── ESPACE PROPRIÉTAIRE ───────────────────────────────────────────────────
  if (mode === "proprio") {
    const blockedH = heuresBloquees(reservations, propriDate);
    const ongletStyle = o => ({ flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: ongletPropri === o ? "#0B6E8A" : "#e8f4f7", color: ongletPropri === o ? "#fff" : "#0B6E8A" });
    return (
      <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
        <Header showSteps={false} />
        <div style={{ padding: "16px 16px 32px" }}>
          <div style={{ display: "flex", gap: 5, marginBottom: 14 }}>
            <button style={ongletStyle("annonce")} onClick={() => setOngletPropri("annonce")}>📝 Annonce</button>
            {adminConnecte && <button style={ongletStyle("maintenance")} onClick={() => setOngletPropri("maintenance")}>🔧 Maintenance</button>}
            <button style={ongletStyle("dispo")} onClick={() => setOngletPropri("dispo")}>🗓 Dispos</button>
            <button style={ongletStyle("extras")} onClick={() => setOngletPropri("extras")}>🎁 Extras</button>
            <button style={ongletStyle("inventaire")} onClick={() => setOngletPropri("inventaire")}>🛋️ État des lieux</button>
            <button style={ongletStyle("reservations")} onClick={() => setOngletPropri("reservations")}>📋 Résas</button>
            <button style={ongletStyle("stats")} onClick={() => setOngletPropri("stats")}>📊 Stats</button>
          </div>

          {ongletPropri === "annonce" && <GestionAnnonce annonce={annonce} setAnnonce={setAnnonce} onVoir={() => setMode("annonce")} />}

                    {ongletPropri === "maintenance" && (
            <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(11,110,138,.10)", padding:"20px 16px", marginBottom:14 }}>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, color:"#0B6E8A", marginBottom:6, fontWeight:700 }}>🔧 Gestion de la maintenance</div>
              <div style={{ fontSize:13, color:"#5a8a96", marginBottom:18, lineHeight:1.5 }}>
                Activez le mode maintenance pour afficher un message aux locataires pendant une intervention. Vous gardez l'accès à l'espace propriétaire.
              </div>

              {/* Toggle maintenance */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background: modeMainenance ? "#fff3f3" : "#e6faf8", borderRadius:12, padding:"16px", border:`2px solid ${modeMainenance?"#FF6B6B":"#4ECDC4"}`, marginBottom:16 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:15, color: modeMainenance?"#c0302a":"#0B6E8A" }}>
                    {modeMainenance ? "🔴 Mode maintenance ACTIF" : "🟢 Application opérationnelle"}
                  </div>
                  <div style={{ fontSize:12, color:"#5a8a96", marginTop:3 }}>
                    {modeMainenance ? "Les locataires voient la page de maintenance" : "Les locataires accèdent normalement à l'appli"}
                  </div>
                </div>
                <div onClick={() => setModeMaintenance(m => !m)}
                  style={{ width:52, height:30, borderRadius:15, background: modeMainenance?"#FF6B6B":"#4ECDC4", cursor:"pointer", position:"relative", transition:"background .3s", flexShrink:0, marginLeft:12 }}>
                  <div style={{ position:"absolute", top:3, left: modeMainenance?25:3, width:24, height:24, borderRadius:"50%", background:"#fff", transition:"left .3s", boxShadow:"0 1px 4px rgba(0,0,0,.25)" }}/>
                </div>
              </div>

              {/* Message personnalisé */}
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#0B6E8A", marginBottom:6, display:"block" }}>Message affiché aux locataires</label>
                <textarea value={messageMainenance} onChange={e => setMessageMaintenance(e.target.value)}
                  style={{ width:"100%", padding:"11px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b0d8e3", outline:"none", background:"#fff", boxSizing:"border-box", height:100, resize:"vertical", lineHeight:1.6 }}/>
              </div>

              {/* Aperçu */}
              <div style={{ background:"#F7F0E6", borderRadius:12, padding:"16px", border:"1px solid #e0d4c0" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#5a8a96", marginBottom:10, textTransform:"uppercase", letterSpacing:.5 }}>Aperçu — Ce que voient les locataires</div>
                <div style={{ textAlign:"center", padding:"16px 12px" }}>
                  <div style={{ fontSize:40, marginBottom:8 }}>🔧</div>
                  <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, fontWeight:700, color:"#0B6E8A", marginBottom:8 }}>Maintenance en cours</div>
                  <div style={{ fontSize:13, color:"#5a8a96", lineHeight:1.6, background:"#fff", borderRadius:10, padding:"12px 14px" }}>{messageMainenance}</div>
                  <div style={{ fontSize:11, color:"#aaa", marginTop:10 }}>Merci de votre patience 🙏</div>
                </div>
              </div>

              {/* Messages rapides */}
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:12, fontWeight:600, color:"#5a8a96", marginBottom:8 }}>Messages rapides :</div>
                {[
                  "🔧 L'application est momentanément en maintenance. Nous revenons très bientôt !",
                  "🏊 La piscine est fermée pour entretien. Réouverture prochainement.",
                  "❄️ Fermeture hivernale. La piscine rouvre au printemps. À bientôt !",
                  "🌊 Traitement de l'eau en cours. Réouverture dans quelques heures.",
                ].map((msg, i) => (
                  <button key={i} onClick={() => setMessageMaintenance(msg)}
                    style={{ width:"100%", textAlign:"left", padding:"9px 12px", borderRadius:8, background: messageMainenance===msg?"#e6faf8":"#f5f5f5", border:`1.5px solid ${messageMainenance===msg?"#4ECDC4":"#e0e0e0"}`, fontSize:12, color:"#2C3E50", cursor:"pointer", marginBottom:6, lineHeight:1.4 }}>
                    {msg}
                  </button>
                ))}
              </div>
            </div>
          )}

          {ongletPropri === "dispo" && (
            <div style={card}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#0B6E8A", marginBottom: 12, fontWeight: 700 }}>🗓 Disponibilités</div>

              {/* Sélecteur de date */}
              <label style={lbl}>Date</label>
              <input type="date" min={today()} value={propriDate} onChange={e => setPropriDate(e.target.value)} style={{ ...inp, marginBottom: 14 }} />

              {/* Boutons rapides */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#5a8a96", marginBottom: 8 }}>Actions rapides pour cette date</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => toutOuvrir(propriDate)} style={{ flex:1, padding:"9px 0", borderRadius:9, background:"#4ECDC4", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    ✓ Tout ouvrir
                  </button>
                  <button onClick={() => toutFermer(propriDate)} style={{ flex:1, padding:"9px 0", borderRadius:9, background:"#FF6B6B", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    ✗ Tout fermer
                  </button>
                </div>
              </div>

              {/* Plage horaire rapide */}
              <div style={{ background:"#f0fafc", borderRadius:10, padding:"12px", border:"1px solid #b0d8e3", marginBottom:14 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#0B6E8A", marginBottom:10 }}>⏱ Ouvrir / Fermer une plage</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                  <div>
                    <label style={lbl}>De</label>
                    <select value={propriDebut} onChange={e => setPropriDebut(+e.target.value)} style={inp}>
                      {ALL_HOURS.map(h => <option key={h} value={h}>{padH(h)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>À</label>
                    <select value={propriFin} onChange={e => setProprieFin(+e.target.value)} style={inp}>
                      {[...ALL_HOURS.filter(h=>h>propriDebut),24].map(h => <option key={h} value={h}>{padH(h)}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => ouvrirPlage(propriDate, propriDebut, propriFin)} style={{ flex:1, padding:"9px 0", borderRadius:9, background:"#4ECDC4", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    ✓ Ouvrir cette plage
                  </button>
                  <button onClick={() => fermerPlage(propriDate, propriDebut, propriFin)} style={{ flex:1, padding:"9px 0", borderRadius:9, background:"#FF6B6B", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    ✗ Fermer cette plage
                  </button>
                </div>
              </div>

              {/* Fermeture sur une période */}
              <div style={{ background:"#fff8e1", borderRadius:10, padding:"12px", border:"1px solid #f0c040", marginBottom:14 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#a06000", marginBottom:10 }}>📅 Fermeture sur une période (ex: hivernale)</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                  <div>
                    <label style={{...lbl, color:"#a06000"}}>Date début</label>
                    <input type="date" min={today()} value={periodeDebut} onChange={e=>setPeriodeDebut(e.target.value)} style={inp}/>
                  </div>
                  <div>
                    <label style={{...lbl, color:"#a06000"}}>Date fin</label>
                    <input type="date" min={periodeDebut||today()} value={periodeFin} onChange={e=>setPeriodeFin(e.target.value)} style={inp}/>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => fermerPeriode(periodeDebut, periodeFin)} style={{ flex:1, padding:"9px 0", borderRadius:9, background:"#FF6B6B", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    ✗ Fermer toute la période
                  </button>
                  <button onClick={() => ouvrirPeriode(periodeDebut, periodeFin)} style={{ flex:1, padding:"9px 0", borderRadius:9, background:"#4ECDC4", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    ✓ Ouvrir toute la période
                  </button>
                </div>
                {periodeDebut && periodeFin && periodeFin >= periodeDebut && (
                  <div style={{ fontSize:12, color:"#a06000", marginTop:6, textAlign:"center" }}>
                    {nbJoursPeriode(periodeDebut, periodeFin)} jour{nbJoursPeriode(periodeDebut, periodeFin)>1?"s":""} concerné{nbJoursPeriode(periodeDebut, periodeFin)>1?"s":""}
                  </div>
                )}
              </div>

              {/* Vue case par case */}
              <div style={{ fontSize:13, color:"#5a8a96", marginBottom:10, lineHeight:1.5 }}>
                Appuyez sur un créneau pour l'<strong style={{color:"#4ECDC4"}}>ouvrir</strong> ou le <strong style={{color:"#FF6B6B"}}>fermer</strong> individuellement.
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
                {ALL_HOURS.map(h => {
                  const res = reservations.find(r => r.date === propriDate && r.heureDebut <= h && r.heureFin > h);
                  const blocked = blockedH.has(h) && !res;
                  const dispo = estOuvert(propriDate, h);
                  const isSoir = h >= 20;
                  let bg, color, border, labelH, cliquable = false;
                  if (res) { bg="#0B6E8A"; color="#fff"; border="2px solid #0B6E8A"; labelH="📅"; }
                  else if (blocked) { bg="#ffe8b0"; color="#a06000"; border="2px solid #f0c040"; labelH="🔒"; }
                  else if (dispo) { bg=isSoir?"#0d5c75":"#4ECDC4"; color="#fff"; border=`2px solid ${isSoir?"#0d5c75":"#4ECDC4"}`; labelH=isSoir?"✓🌙":"✓"; cliquable=true; }
                  else { bg="#f5f5f5"; color="#bbb"; border="2px dashed #ddd"; labelH="—"; cliquable=true; }
                  return (
                    <div key={h} onClick={() => cliquable && toggleCreneauProprio(h)}
                      style={{ borderRadius:10, padding:"9px 5px", fontSize:12, fontWeight:700, background:bg, color, border, cursor:cliquable?"pointer":"not-allowed", minWidth:52, textAlign:"center", transition:"all .15s" }}>
                      {padH(h)}<br/>
                      <span style={{ fontSize:9, fontWeight:400 }}>{labelH}</span>
                      {isSoir && !res && <div style={{ fontSize:8, opacity:.8, marginTop:1 }}>+1€/h</div>}
                    </div>
                  );
                })}
              </div>

              {/* Résumé plages */}
              {(disponibilites[propriDate]||[]).length > 0 ? (
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:"#0B6E8A", marginBottom:6 }}>Plages ouvertes :</div>
                  {(disponibilites[propriDate]||[]).map((p,i) => (
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#e6faf8", borderRadius:8, padding:"7px 12px", marginBottom:5 }}>
                      <span style={{ fontWeight:600, color:"#0B6E8A", fontSize:13 }}>{padH(p.debut)} → {padH(p.fin)}</span>
                      <button onClick={() => fermerPlage(propriDate, p.debut, p.fin)} style={{ background:"none", border:"none", color:"#FF6B6B", cursor:"pointer", fontSize:15, fontWeight:700 }}>×</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize:13, color:"#FF6B6B", textAlign:"center", padding:"8px", background:"#fff0f0", borderRadius:8 }}>
                  ✗ Aucune disponibilité ce jour
                </div>
              )}

              {/* Légende */}
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:12 }}>
                {[["#4ECDC4","Ouvert"],["#0d5c75","Ouvert soirée (+1€)"],["#0B6E8A","Réservé"],["#ffe8b0","Tampon"],["#f5f5f5","Fermé"]].map(([bg,label])=>(
                  <div key={label} style={{display:"flex",alignItems:"center",gap:3,fontSize:10}}>
                    <div style={{width:11,height:11,borderRadius:3,background:bg,border:"1px solid #ccc"}}/>
                    <span style={{color:"#5a8a96"}}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ongletPropri === "extras" && (
            <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(11,110,138,.10)", padding:"20px 16px", marginBottom:14 }}>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, color:"#0B6E8A", marginBottom:12, fontWeight:700 }}>🎁 Gérer les extras</div>

              {extras.map((e, i) => (
                <div key={e.id} style={{ background:"#f0fafc", borderRadius:12, padding:"12px 14px", marginBottom:10, border:"1px solid #b0d8e3" }}>
                  {extraEnEdition === e.id ? (
                    /* Mode édition */
                    <div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                        <div>
                          <label style={{ fontSize:12, fontWeight:600, color:"#0B6E8A", marginBottom:3, display:"block" }}>Emoji</label>
                          <input style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:18, border:"1.5px solid #b0d8e3", textAlign:"center", boxSizing:"border-box" }} value={e.emoji}
                            onChange={ev=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,emoji:ev.target.value}:x))} maxLength={2}/>
                        </div>
                        <div>
                          <label style={{ fontSize:12, fontWeight:600, color:"#0B6E8A", marginBottom:3, display:"block" }}>Nom</label>
                          <input style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b0d8e3", boxSizing:"border-box" }} value={e.nom}
                            onChange={ev=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,nom:ev.target.value}:x))}/>
                        </div>
                      </div>
                      <div style={{ marginBottom:8 }}>
                        <label style={{ fontSize:12, fontWeight:600, color:"#0B6E8A", marginBottom:3, display:"block" }}>Description</label>
                        <textarea style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:12, border:"1.5px solid #b0d8e3", boxSizing:"border-box", height:60, resize:"vertical" }} value={e.description}
                          onChange={ev=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,description:ev.target.value}:x))}/>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
                        <div>
                          <label style={{ fontSize:12, fontWeight:600, color:"#0B6E8A", marginBottom:3, display:"block" }}>Tarif (€)</label>
                          <input type="number" min={0} style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b0d8e3", boxSizing:"border-box" }} value={e.tarif}
                            onChange={ev=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,tarif:+ev.target.value}:x))}/>
                        </div>
                        <div>
                          <label style={{ fontSize:12, fontWeight:600, color:"#0B6E8A", marginBottom:3, display:"block" }}>Type</label>
                          <select style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b0d8e3", boxSizing:"border-box" }} value={e.type}
                            onChange={ev=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,type:ev.target.value}:x))}>
                            <option value="forfait">Forfait location</option>
                            <option value="personne">Par personne</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={()=>setExtraEnEdition(null)} style={{ flex:1, padding:"8px", borderRadius:8, background:"#0B6E8A", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>✓ Valider</button>
                        <button onClick={()=>{ setExtras(prev=>prev.filter((_,j)=>j!==i)); setExtraEnEdition(null); }} style={{ padding:"8px 14px", borderRadius:8, background:"#fff0f0", color:"#FF6B6B", border:"1.5px solid #FF6B6B", fontWeight:700, fontSize:13, cursor:"pointer" }}>🗑 Supprimer</button>
                      </div>
                    </div>
                  ) : (
                    /* Mode affichage */
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ fontSize:26, flexShrink:0 }}>{e.emoji}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:14, color:"#2C3E50" }}>{e.nom}</div>
                        <div style={{ fontSize:11, color:"#5a8a96", marginTop:1 }}>
                          {e.type==="personne"?`${e.tarif} €/pers`:`${e.tarif} € forfait`}
                        </div>
                        <div style={{ fontSize:11, color:"#aaa", marginTop:1, fontStyle:"italic" }}>{e.description}</div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6, alignItems:"center" }}>
                        {/* Toggle actif */}
                        <div onClick={()=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,actif:!x.actif}:x))}
                          style={{ width:42, height:24, borderRadius:12, background:e.actif?"#4ECDC4":"#ddd", cursor:"pointer", position:"relative", transition:"background .2s", flexShrink:0 }}>
                          <div style={{ position:"absolute", top:3, left:e.actif?21:3, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left .2s", boxShadow:"0 1px 3px rgba(0,0,0,.2)" }}/>
                        </div>
                        {/* Modifier */}
                        <button onClick={()=>setExtraEnEdition(e.id)} style={{ width:30, height:30, borderRadius:7, border:"1.5px solid #0B6E8A", background:"#e8f4f7", color:"#0B6E8A", cursor:"pointer", fontSize:14, fontWeight:700 }}>✏️</button>
                        {/* Supprimer direct */}
                        <button onClick={()=>setExtras(prev=>prev.filter((_,j)=>j!==i))} style={{ width:30, height:30, borderRadius:7, border:"none", background:"#fff0f0", color:"#FF6B6B", cursor:"pointer", fontSize:14 }}>🗑</button>
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize:10, color:e.actif?"#4ECDC4":"#aaa", fontWeight:600, marginTop:6 }}>
                    {e.actif?"✓ Visible":"✗ Masqué"}
                  </div>
                </div>
              ))}

              {/* Formulaire ajout */}
              {ajoutExtraMode ? (
                <div style={{ background:"#fff", borderRadius:12, padding:"14px", border:"2px solid #4ECDC4", marginTop:8 }}>
                  <div style={{ fontWeight:700, color:"#0B6E8A", fontSize:14, marginBottom:12 }}>Nouvel extra</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                    <div>
                      <label style={{ fontSize:12, fontWeight:600, color:"#0B6E8A", marginBottom:3, display:"block" }}>Emoji</label>
                      <input style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:18, border:"1.5px solid #b0d8e3", textAlign:"center", boxSizing:"border-box" }} value={nouvelExtra.emoji}
                        onChange={e=>setNouvelExtra(p=>({...p,emoji:e.target.value}))} maxLength={2}/>
                    </div>
                    <div>
                      <label style={{ fontSize:12, fontWeight:600, color:"#0B6E8A", marginBottom:3, display:"block" }}>Nom</label>
                      <input style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b0d8e3", boxSizing:"border-box" }} value={nouvelExtra.nom} placeholder="Ex: Pétanque"
                        onChange={e=>setNouvelExtra(p=>({...p,nom:e.target.value}))}/>
                    </div>
                  </div>
                  <div style={{ marginBottom:8 }}>
                    <label style={{ fontSize:12, fontWeight:600, color:"#0B6E8A", marginBottom:3, display:"block" }}>Description</label>
                    <textarea style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:12, border:"1.5px solid #b0d8e3", boxSizing:"border-box", height:55, resize:"vertical" }} value={nouvelExtra.description}
                      placeholder="Ce qui est inclus..." onChange={e=>setNouvelExtra(p=>({...p,description:e.target.value}))}/>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
                    <div>
                      <label style={{ fontSize:12, fontWeight:600, color:"#0B6E8A", marginBottom:3, display:"block" }}>Tarif (€)</label>
                      <input type="number" min={0} style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b0d8e3", boxSizing:"border-box" }} value={nouvelExtra.tarif}
                        onChange={e=>setNouvelExtra(p=>({...p,tarif:+e.target.value}))}/>
                    </div>
                    <div>
                      <label style={{ fontSize:12, fontWeight:600, color:"#0B6E8A", marginBottom:3, display:"block" }}>Type</label>
                      <select style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b0d8e3", boxSizing:"border-box" }} value={nouvelExtra.type}
                        onChange={e=>setNouvelExtra(p=>({...p,type:e.target.value}))}>
                        <option value="forfait">Forfait location</option>
                        <option value="personne">Par personne</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button style={{ flex:1, padding:"9px", borderRadius:9, background:"#0B6E8A", color:"#fff", border:"none", fontWeight:700, fontSize:14, cursor:"pointer" }} onClick={()=>{
                      if(!nouvelExtra.nom) return;
                      setExtras(prev=>[...prev,{...nouvelExtra,id:"e"+Date.now()}]);
                      setNouvelExtra({nom:"",description:"",tarif:0,type:"forfait",emoji:"✨",actif:true});
                      setAjoutExtraMode(false);
                    }}>Ajouter</button>
                    <button style={{ padding:"9px 16px", borderRadius:9, background:"transparent", color:"#0B6E8A", border:"2px solid #0B6E8A", fontWeight:700, fontSize:14, cursor:"pointer" }} onClick={()=>setAjoutExtraMode(false)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <button style={{ width:"100%", padding:"11px", borderRadius:9, background:"#4ECDC4", color:"#fff", border:"none", fontWeight:700, fontSize:14, cursor:"pointer", marginTop:8 }} onClick={()=>setAjoutExtraMode(true)}>
                  ➕ Ajouter un extra
                </button>
              )}
            </div>
          )}

                    {ongletPropri === "inventaire" && (
            <div style={card}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#0B6E8A", marginBottom: 6, fontWeight: 700 }}>🛋️ État des lieux</div>
              <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 14, lineHeight: 1.5 }}>
                Photographiez chaque élément en bon état. Ces photos serviront de <strong>référence</strong> lors des états des lieux d'entrée et de sortie des locataires. Vous pouvez ajouter ou retirer des éléments selon votre mobilier.
              </div>
              {elementsEdl.map(item => (
                <div key={item} style={{ borderBottom: "1px solid #e8f4f7", paddingBottom: 10, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ flex: 1 }}>
                      <PhotoUploader label={item} photos={inventaire[item] || []} onChange={photos => setInventaire(prev => ({ ...prev, [item]: photos }))} />
                    </div>
                    <button onClick={() => {
                      setElementsEdl(prev => prev.filter(e => e !== item));
                      setInventaire(prev => { const n = { ...prev }; delete n[item]; return n; });
                      supprimerInventaireItem(item);
                    }} style={{ marginLeft: 8, width: 28, height: 28, borderRadius: 7, border: "none", background: "#fff0f0", color: "#FF6B6B", cursor: "pointer", fontSize: 13, flexShrink: 0 }} title="Retirer cet élément">🗑</button>
                  </div>
                </div>
              ))}

              {/* Ajout d'un nouvel élément */}
              <div style={{ display: "flex", gap: 8, marginTop: 10, background: "#f0fafc", borderRadius: 9, padding: "10px", border: "1.5px dashed #4ECDC4" }}>
                <input value={nouvelElementEdl} onChange={e => setNouvelElementEdl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && nouvelElementEdl.trim() && (setElementsEdl(prev => [...prev, nouvelElementEdl.trim()]), setNouvelElementEdl(""))}
                  placeholder="Ex: Plongeoir, Coussin de sol..." style={{ flex: 1, padding: "8px 10px", borderRadius: 6, fontSize: 13, border: "1px solid #b0d8e3", boxSizing: "border-box" }} />
                <button onClick={() => { if (nouvelElementEdl.trim()) { setElementsEdl(prev => [...prev, nouvelElementEdl.trim()]); setNouvelElementEdl(""); } }}
                  style={{ padding: "8px 16px", borderRadius: 6, background: "#0B6E8A", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>+ Ajouter</button>
              </div>

              <div style={{ background: "#e6faf8", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#0B6E8A", fontWeight: 600, marginTop: 12 }}>✓ {Object.values(inventaire).flat().length} photos enregistrées sur {elementsEdl.length} élément{elementsEdl.length > 1 ? "s" : ""}</div>
            </div>
          )}

          {ongletPropri === "reservations" && (
            <div style={card}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#0B6E8A", marginBottom: 12, fontWeight: 700 }}>📋 Réservations</div>

              {/* Demandes en attente mises en avant */}
              {reservations.filter(r => r.statut === "en_attente").length > 0 && (
                <div style={{ background:"#fff8e1", border:"2px solid #f0c040", borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
                  <div style={{ fontWeight:700, color:"#a06000", fontSize:14, marginBottom:4 }}>
                    🔔 {reservations.filter(r => r.statut === "en_attente").length} demande{reservations.filter(r => r.statut === "en_attente").length>1?"s":""} en attente de votre validation
                  </div>
                  <div style={{ fontSize:12, color:"#a06000" }}>Voir ci-dessous, mises en évidence.</div>
                </div>
              )}

              {reservations.length === 0 ? (
                <div style={{ color: "#5a8a96", fontSize: 14, textAlign: "center", padding: "16px 0" }}>Aucune réservation.</div>
              ) : reservations.sort((a, b) => {
                  // En attente d'abord, puis par date
                  if (a.statut === "en_attente" && b.statut !== "en_attente") return -1;
                  if (b.statut === "en_attente" && a.statut !== "en_attente") return 1;
                  return a.date.localeCompare(b.date);
                }).map(r => {
                const noteP = notesLocataires[r.ref];
                const sessionPassee = r.date <= today();
                const statut = r.statut || "acceptee"; // anciennes résas sans statut = acceptées par défaut
                const badgeStatut = {
                  en_attente: { bg:"#fff8e1", color:"#a06000", border:"#f0c040", label:"⏳ En attente" },
                  acceptee: { bg:"#e6faf8", color:"#0B6E8A", border:"#4ECDC4", label:"✓ Acceptée" },
                  refusee: { bg:"#fff0f0", color:"#c0302a", border:"#FF6B6B", label:"✗ Refusée" },
                  annulee: { bg:"#f5f5f5", color:"#888", border:"#ccc", label:"🚫 Annulée" },
                }[statut];
                return (
                  <div key={r.ref} style={{ background: statut==="en_attente" ? "#fffdf5" : "#f0fafc", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: statut==="en_attente" ? "2px solid #f0c040" : "1px solid #b0d8e3" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div style={{ fontWeight: 700, color: "#0B6E8A", fontSize: 13 }}>{r.ref}</div>
                      <span style={{ fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, background:badgeStatut.bg, color:badgeStatut.color, border:`1px solid ${badgeStatut.border}` }}>
                        {badgeStatut.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "#2C3E50", marginTop: 2 }}>{r.prenom} {r.nom} · {r.email}</div>
                    {comptes[r.email]?.ville && <div style={{ fontSize: 11, color: "#5a8a96" }}>📍 {comptes[r.email]?.codePostal} {comptes[r.email]?.ville}</div>}
                    <div style={{ fontSize: 12, color: "#5a8a96" }}>{r.date} · {padH(r.heureDebut ?? parseInt(r.heureDebut))} → {padH(r.heureFin ?? parseInt(r.heureFin))}</div>
                    <div style={{ fontSize: 12, color: "#5a8a96" }}>{r.adultes} adulte{r.adultes > 1 ? "s" : ""}{r.enfants12 > 0 ? ` + ${r.enfants12} enfant` : ""} · {formatEur(r.prix)}</div>
                    {r.note && <div style={{ fontSize: 12, color: "#f0a500", marginTop: 4 }}>💬 {"⭐".repeat(r.note)}{r.commentaire && ` — "${r.commentaire}"`}</div>}
                    {r.photosCasse && r.photosCasse.length > 0 && <div style={{ marginTop: 5, background: "#fff0f0", borderRadius: 7, padding: "5px 10px", fontSize: 12, color: "#FF6B6B" }}>⚠️ Casse : {r.descriptionCasse || "sans description"}</div>}

                    {/* Boutons accepter / refuser pour les demandes en attente */}
                    {statut === "en_attente" && (
                      refusEnCoursRef === r.ref ? (
                        <div style={{ marginTop:10, background:"#fff", borderRadius:10, padding:"12px", border:"1.5px solid #FF6B6B" }}>
                          <div style={{ fontWeight:700, color:"#c0302a", fontSize:13, marginBottom:8 }}>Motif du refus (optionnel)</div>
                          <textarea value={motifRefusVal} onChange={e=>setMotifRefusVal(e.target.value)} placeholder="Ex: créneau finalement indisponible..."
                            style={{ ...inp, height:60, resize:"vertical", fontSize:12, marginBottom:8 }}/>
                          <div style={{ display:"flex", gap:8 }}>
                            <button style={{ flex:1, padding:"9px", borderRadius:8, background:"#FF6B6B", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}
                              onClick={() => { refuserReservation(r.ref, motifRefusVal); setRefusEnCoursRef(null); setMotifRefusVal(""); }}>
                              Confirmer le refus
                            </button>
                            <button style={{ ...btnS, marginTop:0, fontSize:13, padding:"9px" }} onClick={() => { setRefusEnCoursRef(null); setMotifRefusVal(""); }}>Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display:"flex", gap:8, marginTop:10 }}>
                          <button style={{ flex:1, padding:"10px", borderRadius:9, background:"#4ECDC4", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}
                            onClick={() => accepterReservation(r.ref)}>
                            ✓ Accepter
                          </button>
                          <button style={{ flex:1, padding:"10px", borderRadius:9, background:"#fff", color:"#FF6B6B", border:"1.5px solid #FF6B6B", fontWeight:700, fontSize:13, cursor:"pointer" }}
                            onClick={() => setRefusEnCoursRef(r.ref)}>
                            ✗ Refuser
                          </button>
                        </div>
                      )
                    )}

                    {/* Annulation d'une réservation déjà acceptée */}
                    {statut === "acceptee" && !sessionPassee && (
                      annulEnCoursRef === r.ref ? (
                        <div style={{ marginTop:10, background:"#fff", borderRadius:10, padding:"12px", border:"1.5px solid #FF6B6B" }}>
                          <div style={{ fontWeight:700, color:"#c0302a", fontSize:13, marginBottom:8 }}>Motif de l'annulation</div>
                          <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, cursor:"pointer" }}>
                            <input type="checkbox" checked={annulationParLocataireVal} onChange={e=>setAnnulationParLocataireVal(e.target.checked)} style={{ accentColor:"#0B6E8A" }}/>
                            <span style={{ fontSize:12, color:"#2C3E50" }}>Le locataire m'a demandé d'annuler</span>
                          </label>
                          <textarea value={motifAnnulVal} onChange={e=>setMotifAnnulVal(e.target.value)} placeholder="Ex: indisponibilité imprévue de la piscine..."
                            style={{ ...inp, height:60, resize:"vertical", fontSize:12, marginBottom:8 }}/>
                          <div style={{ display:"flex", gap:8 }}>
                            <button style={{ flex:1, padding:"9px", borderRadius:8, background:"#FF6B6B", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}
                              onClick={() => { annulerReservation(r.ref, motifAnnulVal, annulationParLocataireVal); setAnnulEnCoursRef(null); setMotifAnnulVal(""); setAnnulationParLocataireVal(false); }}>
                              Confirmer l'annulation
                            </button>
                            <button style={{ ...btnS, marginTop:0, fontSize:13, padding:"9px" }} onClick={() => { setAnnulEnCoursRef(null); setMotifAnnulVal(""); setAnnulationParLocataireVal(false); }}>Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <button style={{ marginTop:10, width:"100%", padding:"9px", borderRadius:8, background:"#fff", color:"#FF6B6B", border:"1.5px solid #FF6B6B", fontWeight:700, fontSize:13, cursor:"pointer" }}
                          onClick={() => setAnnulEnCoursRef(r.ref)}>
                          🚫 Annuler cette réservation
                        </button>
                      )
                    )}
                    {noteP ? (
                      <div style={{ marginTop: 8, background: "#e6faf8", borderRadius: 8, padding: "7px 10px" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#0B6E8A" }}>Votre note : {"⭐".repeat(noteP.note)}{noteP.note >= 4 ? <span style={{ color: "#4ECDC4", marginLeft: 6 }}>✓ Code accordé</span> : <span style={{ color: "#FF6B6B", marginLeft: 6 }}>✗ Code refusé</span>}</div>
                        {noteP.commentaire && <div style={{ fontSize: 11, color: "#5a8a96" }}>"{noteP.commentaire}"</div>}
                      </div>
                    ) : sessionPassee && statut === "acceptee" && (
                      noteEnCoursRef === r.ref ? (
                        <div style={{ marginTop: 10, background: "#f0fafc", borderRadius: 10, padding: "12px", border: "1px solid #b0d8e3" }}>
                          <div style={{ fontWeight: 700, color: "#0B6E8A", fontSize: 13, marginBottom: 8 }}>⭐ Notez ce locataire</div>
                          <Stars value={noteProprioVal} onChange={setNoteProprioVal} />
                          {noteProprioVal > 0 && <div style={{ marginTop: 6, padding: "5px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: noteProprioVal >= 4 ? "#e6faf8" : "#fff0f0", color: noteProprioVal >= 4 ? "#0B6E8A" : "#FF6B6B", border: `1px solid ${noteProprioVal >= 4 ? "#4ECDC4" : "#FF6B6B"}`, marginBottom: 8, textAlign: "center" }}>{noteProprioVal >= 4 ? "✓ Code promo -5% accordé" : "✗ Pas de code promo"}</div>}
                          <textarea value={commentaireProprioVal} onChange={e => setCommentaireProprioVal(e.target.value)} placeholder="Commentaire..." style={{ ...inp, height: 60, resize: "vertical", fontSize: 12, marginBottom: 8 }} />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button style={{ ...btnP, marginTop: 0, fontSize: 13, padding: "9px" }} onClick={() => soumettreNoteLocataire(r.ref)}>Valider</button>
                            <button style={{ ...btnS, marginTop: 0, fontSize: 13, padding: "9px" }} onClick={() => { setNoteEnCoursRef(null); setNoteProprioVal(0); setCommentaireProprioVal(""); }}>Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <button style={{ marginTop: 10, width: "100%", padding: "8px", borderRadius: 8, background: "#0B6E8A", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }} onClick={() => { setNoteEnCoursRef(r.ref); setNoteProprioVal(0); setCommentaireProprioVal(""); }}>⭐ Noter ce locataire</button>
                      )
                    )}
                    <div style={{ fontSize: 11, color: "#aaa", marginTop: 5 }}>🔒 Tampon : {padH(parseInt(r.heureDebut) - 1)} – {padH(parseInt(r.heureFin) + 1)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {ongletPropri === "stats" && <StatsAvancees reservations={reservations} comptes={comptes} extras={extras} />}


                    <button style={btnS} onClick={() => setMode("accueil")}>← Accueil</button>
          <button style={{ background:"transparent", color:"#FF6B6B", border:"2px solid #FF6B6B", borderRadius:10, padding:"11px 24px", fontSize:14, fontWeight:600, cursor:"pointer", width:"100%", marginTop:8 }}
            onClick={() => { if (adminConnecte) deconnecterAdmin(); if (proprioConnecte) deconnecterProprio(); }}>🔓 Se déconnecter</button>
        </div>
      </div>
    );
  }

  // ── ÉTAPE 1 : Calendrier + horaires ──────────────────────────────────────
  if (mode === "locataire" && step === 1) return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
      <Header showSteps={true} />
      <div style={{ padding: "16px 16px 32px" }}>
        {/* Infos locataire */}
        <div style={card}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, color: "#0B6E8A", marginBottom: 14, fontWeight: 700 }}>Votre réservation</div>
          {!compteConnecte && (
            <div style={{ background: "#e8f4f7", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: "#0B6E8A" }}>
              💡 <a href="#" onClick={e => { e.preventDefault(); setAuthMode("login"); setMode("auth"); }} style={{ color: "#0B6E8A", fontWeight: 700 }}>Connectez-vous</a> pour retrouver vos réservations facilement.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div><label style={lbl}>Prénom *</label><input style={{ ...inp, border: erreurs.prenom ? "2px solid #FF6B6B" : "1.5px solid #b0d8e3" }} value={form.prenom} onChange={e => setF("prenom", e.target.value)} />{erreurs.prenom && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.prenom}</div>}</div>
            <div><label style={lbl}>Nom *</label><input style={{ ...inp, border: erreurs.nom ? "2px solid #FF6B6B" : "1.5px solid #b0d8e3" }} value={form.nom} onChange={e => setF("nom", e.target.value)} />{erreurs.nom && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.nom}</div>}</div>
          </div>
          <div style={{ marginBottom: 10 }}><label style={lbl}>Email *</label><input style={{ ...inp, border: erreurs.email ? "2px solid #FF6B6B" : "1.5px solid #b0d8e3" }} type="email" value={form.email} onChange={e => setF("email", e.target.value)} />{erreurs.email && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.email}</div>}</div>
          <div style={{ marginBottom: 0 }}><label style={lbl}>Téléphone *</label><input style={inp} type="tel" value={form.telephone} onChange={e => setF("telephone", e.target.value)} />{erreurs.telephone && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.telephone}</div>}</div>
        </div>

        {/* Calendrier */}
        <div style={card}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, color: "#0B6E8A", marginBottom: 14, fontWeight: 700 }}>📅 Choisissez votre date</div>
          <CalendrierDisponibilites
            disponibilites={disponibilites} reservations={reservations}
            selectedDate={form.date}
            onSelectDate={d => { setF("date", d); setF("creneaux", []); }}
          />
          {erreurs.date && <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 6 }}>{erreurs.date}</div>}
        </div>

        {/* Grille horaire */}
        {form.date && (
          <div style={card}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, color: "#0B6E8A", marginBottom: 14, fontWeight: 700 }}>⏰ Choisissez vos horaires</div>
            <SelecteurHoraire
              disponibilites={disponibilites} reservations={reservations} date={form.date}
              creneaux={form.creneaux}
              onToggle={c => setF("creneaux", c)}
            />
            {erreurs.creneaux && <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 6, padding:"6px 10px", background:"#fff0f0", borderRadius:8 }}>{erreurs.creneaux}</div>}
          </div>
        )}

        {/* Participants */}
        <div style={card}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "#0B6E8A", marginBottom: 12, fontWeight: 700 }}>Participants</div>
          {[{ key: "adultes", label: "Adultes (12 ans et +)", tarif: `${TARIF_BASE} €/pers/h`, min: 1 }, { key: "enfants12", label: "Enfants (3–11 ans)", tarif: `${TARIF_BASE * .5} €/pers/h (-50%)`, min: 0 }, { key: "moins3", label: "Moins de 3 ans", tarif: "Gratuit", min: 0 }].map(({ key, label, tarif, min }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div><div style={{ fontWeight: 600, fontSize: 13, color: "#2C3E50" }}>{label}</div><div style={{ fontSize: 12, color: "#4ECDC4", fontWeight: 600 }}>{tarif}</div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <button onClick={() => setF(key, Math.max(min, form[key] - 1))} style={{ width: 30, height: 30, borderRadius: "50%", border: "2px solid #0B6E8A", background: "#fff", color: "#0B6E8A", fontSize: 17, fontWeight: 700, cursor: "pointer" }}>−</button>
                <span style={{ fontWeight: 700, fontSize: 17, minWidth: 18, textAlign: "center" }}>{form[key]}</span>
                <button onClick={() => setF(key, form[key] + 1)} style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: "#0B6E8A", color: "#fff", fontSize: 17, fontWeight: 700, cursor: "pointer" }}>+</button>
              </div>
            </div>
          ))}
        </div>

        {/* Récap prix */}
        {form.creneaux.length > 0 && (
          <div style={{ background: "linear-gradient(135deg,#0B6E8A,#4ECDC4)", borderRadius: 13, padding: "13px 16px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: "#b8e8f0", fontSize: 12 }}>{padH(heureDebut)} → {padH(heureFin)} ({duree}h)</div>
              <div style={{ color: "#e0f4f8", fontSize: 11 }}>{form.adultes} adulte{form.adultes > 1 ? "s" : ""}{form.enfants12 > 0 ? ` + ${form.enfants12} enfant` : ""}</div>
              {form.creneaux.some(h => h >= 20) && <div style={{ color: "#ffe082", fontSize: 11 }}>🌙 Majoration soirée incluse (+1€/pers/h après 20h)</div>}
              {remise > 0 && <div style={{ color: "#ffe082", fontSize: 11, fontWeight: 700 }}>Code promo -{remise}% ✓</div>}
            </div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 700, color: "#fff" }}>{formatEur(prixFinal)}</div>
          </div>
        )}
        <button style={btnP} onClick={() => { if (validerEtape1()) setStep(2); }}>Continuer →</button>
        <button style={btnS} onClick={() => setMode("accueil")}>← Accueil</button>
      </div>
    </div>
  );

  // ── ÉTAPE 2 : Règlement ───────────────────────────────────────────────────
  if (mode === "locataire" && step === 2) return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
      <Header showSteps={true} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, color: "#0B6E8A", marginBottom: 12, fontWeight: 700 }}>Règlement intérieur</div>
          <div style={{ background: "#f0fafc", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#2C3E50", lineHeight: 1.7, maxHeight: 280, overflowY: "auto", border: "1px solid #b0d8e3", whiteSpace: "pre-line" }}>{REGLEMENT}</div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 12, marginTop: 16, cursor: "pointer" }}>
            <input type="checkbox" checked={form.reglementAccepte} onChange={e => setF("reglementAccepte", e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, accentColor: "#0B6E8A" }} />
            <span style={{ fontSize: 14, color: "#2C3E50", lineHeight: 1.5 }}>J'ai lu et j'accepte le règlement intérieur.</span>
          </label>
        </div>
        <button style={{ ...btnP, opacity: form.reglementAccepte ? 1 : .5 }} onClick={() => form.reglementAccepte && setStep(3)}>Accepter et continuer →</button>
        <button style={btnS} onClick={() => setStep(1)}>← Retour</button>
      </div>
    </div>
  );

  // ── ÉTAPE 3 : Extras ─────────────────────────────────────────────────────────
  if (mode === "locataire" && step === 3) return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#F7F0E6", minHeight:"100vh" }}>
      <Header showSteps={true}/>
      <div style={{ padding:"16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:19, color:"#0B6E8A", marginBottom:6, fontWeight:700 }}>🎁 Options & extras</div>
          <div style={{ fontSize:13, color:"#5a8a96", marginBottom:16, lineHeight:1.5 }}>
            Personnalisez votre session. Les tarifs sont calculés selon la quantité choisie.
          </div>

          {extras.filter(e => e.actif).map(e => {
            const qte = extrasChoisis[e.id] || 0;
            const montant = e.type === "personne"
              ? e.tarif * qte
              : e.tarif * (qte > 0 ? 1 : 0);
            const sel = qte > 0;
            return (
              <div key={e.id} style={{ borderRadius:13, marginBottom:12, border: sel ? "2px solid #0B6E8A" : "2px solid #e0e0e0", background: sel ? "#f0fafc" : "#fff", overflow:"hidden" }}>
                {/* En-tête */}
                <div style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"14px 14px 10px" }}>
                  <div style={{ fontSize:28, flexShrink:0 }}>{e.emoji}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:14, color:"#2C3E50" }}>{e.nom}</div>
                    <div style={{ fontSize:12, color:"#5a8a96", marginTop:2, lineHeight:1.4 }}>{e.description}</div>
                    <div style={{ fontSize:12, color:"#4ECDC4", fontWeight:600, marginTop:4 }}>
                      {e.type === "personne" ? `${e.tarif} € / personne` : `${e.tarif} € forfait`}
                    </div>
                  </div>
                </div>
                {/* Compteur */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderTop:"1px solid #e8f4f7", background: sel ? "#e6faf8" : "#f9f9f9" }}>
                  {e.type === "personne" ? (
                    /* Compteur quantité */
                    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                      <button onClick={() => setExtrasChoisis(prev => ({ ...prev, [e.id]: Math.max(0, (prev[e.id]||0) - 1) }))}
                        style={{ width:32, height:32, borderRadius:"50%", border:"2px solid #0B6E8A", background:"#fff", color:"#0B6E8A", fontSize:18, fontWeight:700, cursor:"pointer" }}>−</button>
                      <span style={{ fontWeight:700, fontSize:18, minWidth:24, textAlign:"center", color:"#2C3E50" }}>{qte}</span>
                      <button onClick={() => setExtrasChoisis(prev => ({ ...prev, [e.id]: (prev[e.id]||0) + 1 }))}
                        style={{ width:32, height:32, borderRadius:"50%", border:"none", background:"#0B6E8A", color:"#fff", fontSize:18, fontWeight:700, cursor:"pointer" }}>+</button>
                      <span style={{ fontSize:12, color:"#5a8a96" }}>personne{qte > 1 ? "s" : ""}</span>
                    </div>
                  ) : (
                    /* Toggle forfait */
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div onClick={() => setExtrasChoisis(prev => ({ ...prev, [e.id]: prev[e.id] ? 0 : 1 }))}
                        style={{ width:46, height:26, borderRadius:13, background:sel?"#0B6E8A":"#ddd", cursor:"pointer", position:"relative", transition:"background .2s" }}>
                        <div style={{ position:"absolute", top:3, left:sel?23:3, width:20, height:20, borderRadius:"50%", background:"#fff", transition:"left .2s", boxShadow:"0 1px 3px rgba(0,0,0,.2)" }}/>
                      </div>
                      <span style={{ fontSize:13, color:"#2C3E50", fontWeight:600 }}>{sel ? "Inclus" : "Non inclus"}</span>
                    </div>
                  )}
                  {/* Coût calculé */}
                  <div style={{ textAlign:"right" }}>
                    {sel ? (
                      <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, fontWeight:700, color:"#0B6E8A" }}>{formatEur(montant)}</div>
                    ) : (
                      <div style={{ fontSize:13, color:"#bbb" }}>0,00 €</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {extras.filter(e => e.actif).length === 0 && (
            <div style={{ color:"#5a8a96", fontSize:13, textAlign:"center", padding:"16px 0" }}>Aucun extra disponible.</div>
          )}

          {totalExtras > 0 && (
            <div style={{ background:"linear-gradient(135deg,#0B6E8A,#4ECDC4)", borderRadius:10, padding:"12px 16px", marginTop:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:14, fontWeight:700, color:"#fff" }}>Total extras</span>
              <span style={{ fontSize:20, fontWeight:700, color:"#fff", fontFamily:"'Playfair Display',serif" }}>{formatEur(totalExtras)}</span>
            </div>
          )}
        </div>
        <button style={btnP} onClick={() => setStep(4)}>Continuer →</button>
        <button style={btnS} onClick={() => setStep(2)}>← Retour</button>
      </div>
    </div>
  );

  // ── ÉTAPE 4 : Paiement ────────────────────────────────────────────────────
  if (mode === "locataire" && step === 4) return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
      <Header showSteps={true} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, color: "#0B6E8A", marginBottom: 12, fontWeight: 700 }}>Récapitulatif & Paiement</div>
          <div style={{ background: "#f0fafc", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #b0d8e3" }}>
            {[["Locataire", `${form.prenom} ${form.nom}`], ["Date", form.date], ["Créneau", `${padH(heureDebut)} → ${padH(heureFin)} (${duree}h)`], ["Participants", `${form.adultes} adulte${form.adultes > 1 ? "s" : ""}${form.enfants12 > 0 ? ` + ${form.enfants12} enfant` : ""}${form.moins3 > 0 ? ` + ${form.moins3} bébé` : ""}`]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "#5a8a96", fontSize: 13 }}>{k}</span><span style={{ fontWeight: 600, fontSize: 13 }}>{v}</span>
              </div>
            ))}
            <div style={{ height: 1, background: "#b0d8e3", margin: "8px 0" }} />
            {remise > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: "#4ECDC4", fontSize: 13, fontWeight: 600 }}>Code promo -{remise}%</span><span style={{ color: "#4ECDC4", fontSize: 13, fontWeight: 600 }}>-{formatEur(prix - prixFinal)}</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "#0B6E8A" }}>Total</span>
              <div style={{ textAlign: "right" }}>
                {remise > 0 && <div style={{ fontSize: 12, color: "#aaa", textDecoration: "line-through" }}>{formatEur(prix)}</div>}
                <span style={{ fontWeight: 700, fontSize: 19, color: "#0B6E8A" }}>{formatEur(prixFinal)}</span>
              </div>
            </div>
          </div>
          {/* Code promo */}
          <div style={{ background: "#f7f0e6", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #e0d4c0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0B6E8A", marginBottom: 8 }}>🎁 Vous avez un code promo ?</div>
            {codePromoStatut === "ok" ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#e6faf8", borderRadius: 8, padding: "8px 12px", border: "1.5px solid #4ECDC4" }}>
                <div><span style={{ fontWeight: 700, color: "#0B6E8A", fontFamily: "monospace", fontSize: 14 }}>{codePromoSaisi.toUpperCase()}</span><span style={{ color: "#4ECDC4", fontWeight: 600, fontSize: 13, marginLeft: 8 }}>✓ -5% appliqué</span></div>
                <button onClick={annulerCode} style={{ background: "none", border: "none", color: "#FF6B6B", cursor: "pointer", fontSize: 18, fontWeight: 700 }}>×</button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={codePromoSaisi} onChange={e => { setCodePromoSaisi(e.target.value.toUpperCase()); setCodePromoStatut(null); }} placeholder="PISCINE-XXXXX" style={{ ...inp, flex: 1, fontSize: 14, fontFamily: "monospace", border: codePromoStatut && codePromoStatut !== "ok" ? "2px solid #FF6B6B" : "1.5px solid #b0d8e3" }} />
                  <button onClick={verifierCode} style={{ padding: "10px 14px", borderRadius: 8, background: "#0B6E8A", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>Appliquer</button>
                </div>
                {codePromoStatut === "invalide" && <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 5 }}>❌ Code invalide.</div>}
                {codePromoStatut === "utilise" && <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 5 }}>❌ Ce code a déjà été utilisé.</div>}
                {codePromoStatut === "expire" && <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 5 }}>❌ Ce code est expiré.</div>}
              </>
            )}
          </div>
          {/* Récap extras */}
          {totalExtras > 0 && (
            <div style={{ background: "#f0fafc", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #b0d8e3" }}>
              <div style={{ fontWeight: 700, color: "#0B6E8A", fontSize: 13, marginBottom: 8 }}>🎁 Extras sélectionnés</div>
              {extras.filter(e => extrasChoisis[e.id] > 0).map(e => {
                const qte = extrasChoisis[e.id] || 0;
                const nb = e.type === "personne" ? qte : 1;
                return (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span style={{ color: "#2C3E50" }}>{e.emoji} {e.nom}{e.type === "personne" ? ` ×${qte} pers.` : " (forfait)"}</span>
                    <span style={{ fontWeight: 600, color: "#0B6E8A" }}>{formatEur(e.tarif * nb)}</span>
                  </div>
                );
              })}
              <div style={{ height: 1, background: "#b0d8e3", margin: "8px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#0B6E8A" }}>
                <span>Total extras</span><span>{formatEur(totalExtras)}</span>
              </div>
            </div>
          )}

          {/* Total général */}
          <div style={{ background: "linear-gradient(135deg,#0B6E8A,#4ECDC4)", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>Total général</span>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 22, fontFamily: "'Playfair Display',serif" }}>{formatEur(totalGeneral)}</span>
          </div>

          {/* Mode de paiement */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0B6E8A", marginBottom: 10 }}>💳 Mode de paiement</div>
            <div style={{ display: "flex", gap: 10 }}>
              {[
                { val: "cb", emoji: "💳", label: "Carte bancaire", desc: "100% en ligne, paiement sécurisé Stripe" },
                { val: "especes", emoji: "💵", label: "Espèces", desc: "20% d'acompte en ligne, solde le jour J" },
              ].map(({ val, emoji, label, desc }) => (
                <div key={val} onClick={() => setModePaiement(val)}
                  style={{ flex: 1, padding: "12px 10px", borderRadius: 12, cursor: "pointer", textAlign: "center", border: modePaiement === val ? "2px solid #0B6E8A" : "2px solid #e0e0e0", background: modePaiement === val ? "#f0fafc" : "#fff", transition: "all .15s" }}>
                  <div style={{ fontSize: 26, marginBottom: 4 }}>{emoji}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#2C3E50" }}>{label}</div>
                  <div style={{ fontSize: 11, color: "#5a8a96", marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Détail selon mode */}
          {modePaiement === "especes" && (
            <div style={{ background: "#fff8e1", borderRadius: 10, padding: "12px 14px", border: "2px solid #f0c040", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: "#a06000", fontSize: 13, marginBottom: 6 }}>💵 Détail paiement espèces</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: "#5a8a96" }}>Acompte en ligne (20%)</span>
                <span style={{ fontWeight: 700, color: "#a06000" }}>{formatEur(acompte)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#5a8a96" }}>Reste à régler le jour J</span>
                <span style={{ fontWeight: 700, color: "#2C3E50" }}>{formatEur(resteARegler)}</span>
              </div>
            </div>
          )}
          {modePaiement === "cb" && (
            <div style={{ background: "#e6faf8", borderRadius: 10, padding: "10px 14px", marginBottom: 12, border: "1px solid #4ECDC4" }}>
              <div style={{ fontSize: 13, color: "#0B6E8A" }}>✓ Paiement intégral <strong>{formatEur(totalGeneral)}</strong> sécurisé par Stripe.</div>
            </div>
          )}

          <div style={{ border: "2px dashed #b0d8e3", borderRadius: 10, padding: "12px", textAlign: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 20, marginBottom: 3 }}>💳</div>
            <div style={{ fontWeight: 600, color: "#0B6E8A", marginBottom: 2 }}>Paiement sécurisé Stripe</div>
            <div style={{ fontSize: 12, color: "#5a8a96" }}>Module Stripe activé lors du déploiement.</div>
          </div>
          <button style={{ ...btnP, opacity: modePaiement ? 1 : 0.5 }} onClick={() => modePaiement && confirmerReservation()}>
            {modePaiement === "especes" ? `✓ Payer l'acompte ${formatEur(acompte)}` : `✓ Payer ${formatEur(totalGeneral)}`}
          </button>
          <button style={btnS} onClick={() => setStep(3)}>← Retour</button>
        </div>
      </div>
    </div>
  );

  // ── PAGE ÉTAT DES LIEUX D'ENTRÉE (le jour J, depuis Mon compte ou la bannière) ──
  if (mode === "edlEntree") return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, color: "#0B6E8A", marginBottom: 6, fontWeight: 700 }}>État des lieux — Arrivée</div>
          <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 6 }}>Réservation {reservation?.ref}</div>
          <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 14, lineHeight: 1.5 }}>Photographiez chaque élément avant votre session. Les photos dorées sont les références propriétaire.</div>
          {elementsEdl.map(item => (
            <div key={item} style={{ borderBottom: "1px solid #e8f4f7", paddingBottom: 10, marginBottom: 10 }}>
              <PhotoUploader label={item} photos={photosAvant.filter(p => p.item === item)} reference={inventaire[item] || []} onChange={photos => setPhotosAvant(prev => [...prev.filter(p => p.item !== item), ...photos.map(p => ({ ...p, item }))])} />
            </div>
          ))}
          <div style={{ fontSize: 12, color: "#5a8a96", marginBottom: 10 }}>📷 {photosAvant.length} photo{photosAvant.length > 1 ? "s" : ""}</div>
          <button style={btnP} onClick={validerEdlEntree}>✓ Valider et commencer la session</button>
          <button style={btnS} onClick={() => setMode(compteConnecte ? "compte" : "accueil")}>← Retour</button>
        </div>
      </div>
    </div>
  );

  // ── ÉTAPE 6 : Confirmation / En attente ───────────────────────────────────
  if (mode === "locataire" && step === 5) {
    // Lire le statut le plus à jour (au cas où le propriétaire a déjà répondu très vite)
    const resaActuelle = reservations.find(r => r.ref === reservation?.ref) || reservation;
    const statut = resaActuelle?.statut || "en_attente";

    if (statut === "en_attente") return (
      <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
        <Header showSteps={true} />
        <div style={{ padding: "16px 16px 32px" }}>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>⏳</div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 21, color: "#0B6E8A", fontWeight: 700, marginBottom: 6 }}>Demande envoyée !</div>
            <div style={{ display: "inline-block", background: "#f0c040", color: "#fff", borderRadius: 8, padding: "4px 13px", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{reservation?.ref}</div>
            <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 14, lineHeight: 1.7 }}>
              Votre demande de réservation est <strong>en attente de validation</strong> par le propriétaire.<br/>
              Vous recevrez un email à <strong>{form.email}</strong> dès qu'elle sera traitée.
            </div>
            <div style={{ background: "#fff8e1", borderRadius: 10, padding: "11px 13px", border: "2px solid #f0c040", marginBottom: 12, textAlign: "left" }}>
              <div style={{ fontWeight: 700, color: "#a06000", marginBottom: 4 }}>ℹ️ Que se passe-t-il maintenant ?</div>
              <div style={{ fontSize: 13, color: "#2C3E50", lineHeight: 1.6 }}>
                Le propriétaire va examiner votre demande. Si elle est acceptée, votre créneau sera confirmé. Si elle est refusée, vous serez remboursé(e).
              </div>
            </div>
            <button style={btnP} onClick={() => { resetSession(); setMode(compteConnecte?"compte":"accueil"); }}>
              {compteConnecte ? "Voir mes réservations" : "Retour à l'accueil"}
            </button>
          </div>
        </div>
      </div>
    );

    if (statut === "refusee") return (
      <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
        <Header showSteps={true} />
        <div style={{ padding: "16px 16px 32px" }}>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>😔</div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 21, color: "#FF6B6B", fontWeight: 700, marginBottom: 6 }}>Demande refusée</div>
            <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 14, lineHeight: 1.7 }}>
              Le propriétaire n'a pas pu accepter votre demande pour ce créneau.
              {resaActuelle?.motifRefus && <><br/><em>"{resaActuelle.motifRefus}"</em></>}
              <br/>Vous serez remboursé(e) intégralement.
            </div>
            <button style={btnP} onClick={() => { resetSession(); setMode("locataire"); setStep(1); }}>Choisir un autre créneau</button>
          </div>
        </div>
      </div>
    );

    if (statut === "annulee") return (
      <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
        <Header showSteps={true} />
        <div style={{ padding: "16px 16px 32px" }}>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>🚫</div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 21, color: "#FF6B6B", fontWeight: 700, marginBottom: 6 }}>Réservation annulée</div>
            <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 14, lineHeight: 1.7 }}>
              Votre réservation pourtant confirmée a été annulée.
              {resaActuelle?.motifAnnulation && <><br/><em>"{resaActuelle.motifAnnulation}"</em></>}
              <br/>Vous serez remboursé(e) intégralement.
            </div>
            <button style={btnP} onClick={() => { resetSession(); setMode(compteConnecte?"compte":"accueil"); }}>
              {compteConnecte ? "Voir mes réservations" : "Retour à l'accueil"}
            </button>
          </div>
        </div>
      </div>
    );

    // statut === "acceptee"
    return (
      <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
        <Header showSteps={true} />
        <div style={{ padding: "16px 16px 32px" }}>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>🎉</div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 21, color: "#0B6E8A", fontWeight: 700, marginBottom: 6 }}>Réservation confirmée !</div>
            <div style={{ display: "inline-block", background: "#4ECDC4", color: "#fff", borderRadius: 8, padding: "4px 13px", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{reservation?.ref}</div>
            <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 14, lineHeight: 1.7 }}>Confirmation envoyée à <strong>{form.email}</strong>.<br />Profitez bien ! 🌊</div>
            <div style={{ background: "#e6faf8", borderRadius: 10, padding: "11px 13px", border: "2px solid #4ECDC4", marginBottom: 12, textAlign: "left" }}>
              <div style={{ fontWeight: 700, color: "#0B6E8A", marginBottom: 4 }}>📅 Le jour de votre venue</div>
              <div style={{ fontSize: 13, color: "#2C3E50", lineHeight: 1.6 }}>À l'heure de votre créneau, vous pourrez réaliser l'état des lieux d'entrée et de sortie directement depuis votre espace "Mon compte".</div>
            </div>
            <button style={btnP} onClick={() => { resetSession(); setMode(compteConnecte?"compte":"accueil"); }}>
              {compteConnecte ? "Voir mes réservations" : "Retour à l'accueil"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PAGE ÉTAT DES LIEUX DE SORTIE (le jour J, depuis Mon compte ou la bannière) ──
  if (mode === "edlSortie") return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, color: "#0B6E8A", marginBottom: 6, fontWeight: 700 }}>État des lieux — Départ</div>
          <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 6 }}>Réservation {reservation?.ref}</div>
          <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 14 }}>Photographiez chaque élément dans l'état où vous le laissez.</div>
          {elementsEdl.map(item => (
            <div key={item} style={{ borderBottom: "1px solid #e8f4f7", paddingBottom: 10, marginBottom: 10 }}>
              <PhotoUploader label={item} photos={photosApres.filter(p => p.item === item)} reference={inventaire[item] || []} onChange={photos => setPhotosApres(prev => [...prev.filter(p => p.item !== item), ...photos.map(p => ({ ...p, item }))])} />
            </div>
          ))}
          <div style={{ background: "#fff3f3", borderRadius: 10, padding: "13px", border: "2px solid #FF6B6B", marginTop: 4, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, color: "#FF6B6B", fontSize: 14, marginBottom: 10 }}>⚠️ Signalement de dégât</div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 10 }}>
              <input type="checkbox" checked={signalementCasse} onChange={e => setSignalementCasse(e.target.checked)} style={{ width: 18, height: 18, accentColor: "#FF6B6B" }} />
              <span style={{ fontSize: 14, color: "#2C3E50" }}>Je signale un dégât ou une casse</span>
            </label>
            {signalementCasse && (
              <>
                <div style={{ marginBottom: 10 }}><label style={{ ...lbl, color: "#FF6B6B" }}>Description</label><textarea value={descriptionCasse} onChange={e => setDescriptionCasse(e.target.value)} placeholder="Décrivez ce qui s'est passé..." style={{ ...inp, height: 70, resize: "vertical", fontSize: 13 }} /></div>
                <PhotoUploader label="Photos du dégât" photos={photosCasse} onChange={setPhotosCasse} />
              </>
            )}
          </div>
          <button style={btnP} onClick={cloturerSession}>✓ Clôturer la session</button>
        </div>
      </div>
    </div>
  );

  // ── ÉTAPE 7 : Avis ────────────────────────────────────────────────────────
  if (mode === "locataire" && step === 7) return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#F7F0E6", minHeight: "100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>✅</div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 21, color: "#0B6E8A", fontWeight: 700, marginBottom: 6 }}>Session clôturée !</div>
          <div style={{ fontSize: 13, color: "#5a8a96" }}>Merci pour votre visite 🌊</div>
        </div>
        {!avisEnvoye ? (
          <div style={card}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, color: "#0B6E8A", marginBottom: 6, fontWeight: 700, textAlign: "center" }}>Votre avis nous est précieux</div>
            <div style={{ fontSize: 13, color: "#5a8a96", textAlign: "center", marginBottom: 10 }}>Si vous avez été un locataire exemplaire, vous pourriez recevoir un <strong>code -5%</strong> valable 1 mois !</div>
            <Stars value={note} onChange={setNote} />
            <div style={{ marginTop: 10 }}><label style={lbl}>Commentaire (optionnel)</label><textarea value={commentaire} onChange={e => setCommentaire(e.target.value)} placeholder="Partagez votre expérience..." style={{ ...inp, height: 80, resize: "vertical", fontSize: 13 }} /></div>
            <button style={{ ...btnP, opacity: note === 0 ? .5 : 1 }} onClick={soumettreAvis}>Envoyer mon avis</button>
          </div>
        ) : (() => {
          const noteP = notesLocataires[reservation?.ref];
          if (!noteP) return (
            <div style={card}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>⏳</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, color: "#0B6E8A", fontWeight: 700, marginBottom: 8 }}>Merci pour votre avis !</div>
                <div style={{ fontSize: 13, color: "#5a8a96", lineHeight: 1.7 }}>{"⭐".repeat(note)} — votre retour a bien été enregistré.<br />Si le propriétaire vous attribue 4 étoiles ou plus, vous recevrez un <strong>code -5%</strong> par email.</div>
              </div>
            </div>
          );
          if (noteP.note >= 4 && codePromo) return (
            <div style={card}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>🎁</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, color: "#0B6E8A", fontWeight: 700, marginBottom: 6 }}>Bravo, vous méritez une réduction !</div>
                <div style={{ fontSize: 13, color: "#5a8a96", marginBottom: 14 }}>Le propriétaire vous a attribué <strong>{"⭐".repeat(noteP.note)}</strong>.<br />Code <strong>-5%</strong> valable jusqu'au <strong>{codePromo?.expiration}</strong> :</div>
                <div style={{ background: "linear-gradient(135deg,#0B6E8A,#4ECDC4)", borderRadius: 12, padding: "14px 18px", display: "inline-block", marginBottom: 12 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: 2, fontFamily: "monospace" }}>{codePromo?.code}</div>
                  <div style={{ fontSize: 11, color: "#b8e8f0", marginTop: 2 }}>-5% · usage unique · 1 mois</div>
                </div>
                <div style={{ fontSize: 12, color: "#5a8a96" }}>📋 Copiez ce code pour votre prochaine réservation.</div>
              </div>
            </div>
          );
          return (
            <div style={card}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>🌊</div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, color: "#0B6E8A", fontWeight: 700, marginBottom: 8 }}>Merci pour votre visite !</div>
                <div style={{ fontSize: 13, color: "#5a8a96", lineHeight: 1.7 }}>Votre avis a bien été pris en compte.<br />Nous espérons vous revoir bientôt ! 😊</div>
              </div>
            </div>
          );
        })()}
        <button style={btnP} onClick={() => { resetSession(); setMode(compteConnecte ? "compte" : "accueil"); }}>
          {compteConnecte ? "Voir mes réservations" : "Retour à l'accueil"}
        </button>
      </div>
    </div>
  );

  return null;
}
