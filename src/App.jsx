import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  chargerAnnonce, sauvegarderAnnonce,
  chargerDisponibilites, sauvegarderDisponibilites, sauvegarderDisponibilitesPartiel, supprimerDateDisponibilite,
  chargerReservations, sauvegarderReservation,
  chargerComptes, sauvegarderCompte,
  chargerInventaire, sauvegarderInventaireItem, supprimerInventaireItem,
  chargerElementsEdl, sauvegarderElementsEdl,
  chargerExtras, sauvegarderExtras, supprimerExtra,
  chargerBanqueImages, sauvegarderImageBanque, supprimerImageBanque,
  chargerCodesPromo, sauvegarderCodePromo,
  chargerNotesLocataires, sauvegarderNoteLocataire,
  chargerConfig, sauvegarderConfig,
  supprimerToutesReservations, supprimerToutesNotesLocataires, supprimerTousCodesPromo,
  ecouterReservations, ecouterAnnonce,
} from "./supabase.js";
import {
  envoyerEmailNouvelleDemande, envoyerEmailAcceptation,
  envoyerEmailRefus, envoyerEmailAnnulation,
  envoyerSmsNouvelleDemande, envoyerEmailCodePromo, envoyerEmailRemboursementCommercial,
  envoyerEmailEdlAValider, envoyerSmsEdlAValider, envoyerSmsInvitationPaiement,
} from "./emails.js";

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

// Tarifs de groupe spéciaux : forfait fixe (3h), équivalent à 5€/pers/h.
// Sélectionner une formule désactive la remise fidélité par tranche, mais
// l'extra "Zéro vis-à-vis" reste offert (le forfait dépasse toujours 30€).
const FORMULES_GROUPE = {
  groupe10: { label: "Formule Groupe — 10 personnes max", maxPersonnes: 10, dureeSlots: 6, prix: 150 },
  groupe5: { label: "Formule Groupe — 5 adultes max", maxAdultes: 5, dureeSlots: 6, prix: 75 },
};

// Liste historique des extras proposés sur Swimmy (ancienne annonce), à
// rajouter en complément des extras déjà en place dans l'app.
const EXTRAS_SWIMMY = [
  { id:"e1", nom:"Option Zéro Vis à Vis", description:"Jardin + terrasse privatisés pour votre session. Aucun regard extérieur.", tarif:15, type:"forfait", emoji:"🌿", actif:true },
  { id:"swk_serviettes", nom:"Serviettes", description:"Serviette de piscine fournie par personne.", tarif:5, type:"personne", emoji:"🏖️", actif:true },
  { id:"swk_molkky", nom:"Molkky", description:"Jeu de quilles finlandais à disposition pour toute la session.", tarif:2, type:"forfait", emoji:"🎯", actif:true },
  { id:"swk_bouee_adultes", nom:"Bouée adultes", description:"Bouée gonflable format adulte.", tarif:2, type:"personne", emoji:"🔵", actif:true },
  { id:"swk_bouee_enfant", nom:"Bouée enfant", description:"Bouée gonflable format enfant.", tarif:2, type:"personne", emoji:"🟠", actif:true },
  { id:"swk_brassard_enfants", nom:"Brassard enfants", description:"Paire de brassards de sécurité enfant.", tarif:2, type:"personne", emoji:"🦺", actif:true },
  { id:"swk_brassard_adulte", nom:"Brassard adulte", description:"Paire de brassards de sécurité adulte.", tarif:2, type:"personne", emoji:"🦺", actif:true },
  { id:"swk_velo", nom:"Vélo enfants, adultes", description:"Vélo à disposition, tailles enfant et adulte.", tarif:2, type:"personne", emoji:"🚲", actif:true },
  { id:"swk_hautparleur", nom:"Haut parleur Perf Roseland", description:"Enceinte bluetooth mise à disposition pour la session.", tarif:5, type:"forfait", emoji:"🔊", actif:true },
  { id:"swk_transat", nom:"Transat flottant", description:"Transat gonflable flottant pour se relaxer sur l'eau.", tarif:2, type:"personne", emoji:"🛶", actif:true },
];

// Emoji suggérés pour illustrer un extra rapidement, sans avoir à les taper
const EMOJI_SUGGESTIONS = [
  "🏊","🛟","🔵","🟠","🦺","🩱","🏖️","🌂","🕶️","💦",
  "🍖","🍹","🧊","🥤","🍉","🎉","🎈","🎊","🎁","🎯",
  "🎵","🔊","📸","🎮","🪁","🎪","🎨","🧺","🚲","⚽",
  "🏐","🎾","🥏","🌿","🌸","🌙","☀️","🔥","❄️","✨",
  "🚿","🧴","📦","🚗","🅿️","🧖","🛶","🏝️","⭐","💧",
];

// ─── Zone de signature (doigt sur mobile, souris sur ordinateur) ─────────────
// Utilisée à la fin de l'état des lieux : le locataire signe, la signature est
// convertie en image (dataURL) et jointe à l'état des lieux envoyé à la
// propriétaire pour validation.
function ZoneSignature({ onChange }) {
  const canvasRef = useRef(null);
  const dessinEnCours = useRef(false);
  const [vide, setVide] = useState(true);

  function coords(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * (canvas.width / rect.width), y: (src.clientY - rect.top) * (canvas.height / rect.height) };
  }
  function debut(e) {
    e.preventDefault();
    dessinEnCours.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = coords(e);
    ctx.beginPath(); ctx.moveTo(x, y);
  }
  function trace(e) {
    if (!dessinEnCours.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    ctx.strokeStyle = "#2C3E50"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    const { x, y } = coords(e);
    ctx.lineTo(x, y); ctx.stroke();
    if (vide) setVide(false);
  }
  function fin() {
    if (!dessinEnCours.current) return;
    dessinEnCours.current = false;
    onChange(vide ? null : canvasRef.current.toDataURL("image/png"));
  }
  function effacer() {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setVide(true);
    onChange(null);
  }
  return (
    <div>
      <canvas ref={canvasRef} width={600} height={200}
        onMouseDown={debut} onMouseMove={trace} onMouseUp={fin} onMouseLeave={fin}
        onTouchStart={debut} onTouchMove={trace} onTouchEnd={fin}
        style={{ width: "100%", height: 120, background: "#fff", border: "2px dashed #b8e0f8", borderRadius: 10, touchAction: "none", cursor: "crosshair" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 5 }}>
        <span style={{ fontSize: 11, color: "#6b7f8c" }}>{vide ? "✍️ Signez ci-dessus (doigt ou souris)" : "✓ Signature enregistrée"}</span>
        {!vide && <button type="button" onClick={effacer} style={{ background: "none", border: "none", color: "#FF6B6B", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Effacer</button>}
      </div>
    </div>
  );
}

function SelecteurEmoji({ onChoisir }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:10, background:"#f9f9f9", borderRadius:8, padding:10, border:"1px solid #e0e0e0", maxHeight:160, overflowY:"auto" }}>
      {EMOJI_SUGGESTIONS.map(em => (
        <button key={em} onClick={()=>onChoisir(em)} type="button"
          style={{ width:34, height:34, borderRadius:7, border:"1.5px solid #e0e0e0", background:"#fff", fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
          {em}
        </button>
      ))}
    </div>
  );
}

const EXTRAS_DEFAUT = [
  { id:"e1", nom:"Zéro vis-à-vis", description:"Jardin + terrasse privatisés pour votre session. Aucun regard extérieur.", tarif:15, type:"forfait", emoji:"🌿", actif:true },
  { id:"e2", nom:"Barbecue", description:"Barbecue à charbon mis à disposition avec allumage. Charbon inclus.", tarif:5, type:"personne", emoji:"🍖", actif:true },
  { id:"e3", nom:"Hamac flottant", description:"Hamac gonflable pour se relaxer sur l'eau.", tarif:2, type:"personne", emoji:"🏝️", actif:true },
  { id:"e4", nom:"Bouée", description:"Bouée gonflable pour les enfants et adultes.", tarif:2, type:"personne", emoji:"🔵", actif:true },
];
const ALL_HOURS = [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
const PAS = 0.5; // granularité des créneaux : 30 minutes
const TAMPON = 0.5; // tampon de 30 min avant et après chaque réservation
const ALL_SLOTS = ALL_HOURS.flatMap(h => [h, h + 0.5]); // créneaux de 30 min : 7:00, 7:30, ... 23:30
const MIN_SLOTS = 2; // réservation minimum : 1 heure = 2 créneaux de 30 min
const TARIF_SOIREE = 1; // majoration €/pers/h après 20h

// ─── Comptes Admin & Propriétaire ──────────────────────────────────────────────
// Les mots de passe ne sont plus ici : ils vivent uniquement dans les variables
// d'environnement Vercel (ADMIN_PASSWORD / PROPRIO_PASSWORD) et sont vérifiés
// côté serveur par /api/connexion-admin et /api/connexion-proprio.
const ADMIN_EMAIL = "aurelie.briand@yahoo.fr";
const PROPRIO_EMAIL = "aurelie.briand@yahoo.fr";
const JOURS = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function prixTotal(adultes, enfants12, creneaux) {
  if (creneaux.length === 0) return 0;
  let total = 0;
  creneaux.forEach(h => {
    // Chaque créneau vaut 30 min → tarif horaire / 2
    const tarif = (TARIF_BASE + (h >= 20 ? TARIF_SOIREE : 0)) * PAS;
    const tarifEnfant = ((TARIF_BASE * 0.5) + (h >= 20 ? TARIF_SOIREE * 0.5 : 0)) * PAS;
    total += adultes * tarif + enfants12 * tarifEnfant;
  });
  return +total.toFixed(2);
}

// Détail du prix pour affichage (en heures)
function detailPrix(adultes, enfants12, creneaux) {
  const normal = creneaux.filter(h => h < 20);
  const soir = creneaux.filter(h => h >= 20);
  return { normal: normal.length * PAS, soir: soir.length * PAS };
}
function formatEur(n) { return (n || 0).toFixed(2).replace(".", ",") + " €"; }

// ─── Compression d'image ─────────────────────────────────────────────────────
// Les photos de téléphone pèsent 3 à 10 Mo. Encodées en base64 pour être
// stockées, elles dépassent les limites de la base de données et l'enregistrement
// échoue silencieusement. On les redimensionne donc avant tout enregistrement :
// 1600 px sur le plus grand côté en JPEG qualité 0,82 suffit largement pour un
// affichage web et ramène le poids autour de 200 à 400 Ko.
function compresserImage(file, maxDimension = 1600, qualite = 0.82) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error("Lecture du fichier impossible"));
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image illisible"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        // Fond blanc : évite qu'un PNG transparent devienne noir en JPEG
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", qualite));
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(file);
  });
}
function today() { return new Date().toISOString().split("T")[0]; }
function padH(h) {
  const n = parseFloat(h);
  const heure = Math.floor(n) % 24;
  const minutes = Math.round((n - Math.floor(n)) * 60);
  return String(heure).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}
// Durée lisible à partir d'un nombre de créneaux de 30 min : 2 → "1h", 3 → "1h30"
function formatDuree(nbSlots) {
  const heures = Math.floor(nbSlots * PAS);
  const demi = nbSlots % 2 !== 0;
  if (heures === 0) return "30 min";
  return `${heures}h${demi ? "30" : ""}`;
}
// Heure décimale → "HH:MM:SS" (pour construire des Date)
function heureToTime(h) {
  const n = parseFloat(h);
  const heure = Math.floor(n);
  const minutes = Math.round((n - heure) * 60);
  return `${String(heure).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}
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
  // Seules les réservations effectivement PAYÉES bloquent le créneau — une
  // demande en attente ou acceptée mais non payée n'empêche pas d'autres
  // visiteurs de demander (et potentiellement obtenir) le même créneau.
  reservations.filter(r => r.date === date && r.paiement?.statut === "paye").forEach(r => {
    const debut = parseFloat(r.heureDebut), fin = parseFloat(r.heureFin);
    // Tampon de 30 min avant et après la réservation
    for (let h = debut - TAMPON; h < fin + TAMPON; h += PAS) blocked.add(h);
  });
  return blocked;
}

// Pour une date donnée : retourne le statut créneau par créneau (pas de 30 min)
function statutHeures(disponibilites, reservations, date) {
  const plages = disponibilites[date] || [];
  const blocked = heuresBloquees(reservations, date);
  const result = {};
  ALL_SLOTS.forEach(h => {
    const dispo = plages.some(p => h >= p.debut && h < p.fin);
    const res = reservations.find(r => r.date === date && r.paiement?.statut === "paye" && parseFloat(r.heureDebut) <= h && parseFloat(r.heureFin) > h);
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
  // Le créneau de 30 min avant et celui après doivent être libres ou hors plage
  const avant = statuts[min - PAS];
  const apres = statuts[max + PAS]; // créneau de 30 min juste après la fin de la sélection
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
// ─── Identité légale de l'entreprise ─────────────────────────────────────────
// Ces constantes alimentent les mentions légales, les CGV et la politique de
// confidentialité. Une seule source de vérité : modifier ici met tout à jour.
const SOCIETE_NOM = "AB KAIZEN";
const SOCIETE_FORME = "Société par actions simplifiée à associé unique (SASU)";
const SOCIETE_CAPITAL = "1 000,00 €";
const SOCIETE_RCS = "107 413 965 R.C.S. Angers";
const SOCIETE_SIREN = "107 413 965";
const SOCIETE_EUID = "FR4901.107413965";
const SOCIETE_IMMATRICULATION = "22/07/2026";
const SOCIETE_ADRESSE = "Lieu-dit le Bois Séné, 49000 Écouflant";
const SOCIETE_DIRECTEUR_PUBLICATION = "Aurélie BRIAND, Présidente";
const EMAIL_CONTACT = "contact@mypiscineprivee.com";
// Numéro volontairement non publié sur le site. Le contact se fait par email
// (et par WhatsApp via le bouton flottant). Voir la note de conformité :
// l'article L111-1 du Code de la consommation demande un numéro de téléphone
// pour la vente à distance — à réactiver ici si un numéro pro est ouvert.
const TELEPHONE_CONTACT = "";

// Médiateur de la consommation — OBLIGATOIRE pour toute activité B2C en France
// (art. L612-1 du Code de la consommation). Renseigner dès l'adhésion à un
// médiateur agréé, puis les coordonnées s'affichent automatiquement dans les CGV.
const MEDIATEUR_NOM = "";       // ex : "CM2C"
const MEDIATEUR_ADRESSE = "";   // ex : "14 rue Saint Jean, 75017 Paris"
const MEDIATEUR_SITE = "";      // ex : "https://www.cm2c.net"

// Conservés pour compatibilité avec le reste du code
const RESPONSABLE_TRAITEMENT = SOCIETE_NOM;
const ADRESSE_RESPONSABLE = SOCIETE_ADRESSE;
const EMAIL_CONTACT_RGPD = EMAIL_CONTACT;

const MENTIONS_LEGALES = `MENTIONS LÉGALES

Dernière mise à jour : ${new Date().toLocaleDateString("fr-FR")}

1. ÉDITEUR DU SITE

Dénomination sociale : ${SOCIETE_NOM}
Forme juridique : ${SOCIETE_FORME}
Capital social : ${SOCIETE_CAPITAL}
Siège social : ${SOCIETE_ADRESSE}
Immatriculation : ${SOCIETE_RCS}, le ${SOCIETE_IMMATRICULATION}
Numéro SIREN : ${SOCIETE_SIREN}
Identifiant européen (EUID) : ${SOCIETE_EUID}

Directrice de la publication : ${SOCIETE_DIRECTEUR_PUBLICATION}
Contact : ${EMAIL_CONTACT}${TELEPHONE_CONTACT ? " — " + TELEPHONE_CONTACT : ""}

2. HÉBERGEUR

Le site est hébergé par Vercel Inc.
340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis
https://vercel.com

La base de données est hébergée par Supabase (infrastructure située dans l'Union européenne).

3. ACTIVITÉ

Le site mypiscineprivee.com propose la réservation en ligne de créneaux de location d'une piscine privée située à Écouflant (49000), à destination de particuliers.

4. PROPRIÉTÉ INTELLECTUELLE

L'ensemble des contenus présents sur ce site (textes, photographies, éléments graphiques, structure) est la propriété exclusive de ${SOCIETE_NOM}, sauf mention contraire. Toute reproduction ou représentation, totale ou partielle, sans autorisation écrite préalable est interdite.

5. SIGNALER UN CONTENU

Pour toute question, réclamation ou signalement relatif au site : ${EMAIL_CONTACT}`;

const POLITIQUE_CONFIDENTIALITE = `POLITIQUE DE CONFIDENTIALITÉ

Dernière mise à jour : ${new Date().toLocaleDateString("fr-FR")}

1. RESPONSABLE DU TRAITEMENT

Le responsable du traitement des données collectées sur ce site est :
${SOCIETE_NOM} — ${SOCIETE_FORME}
${SOCIETE_ADRESSE}
${SOCIETE_RCS}
Email : ${EMAIL_CONTACT}

2. DONNÉES COLLECTÉES

Dans le cadre de l'utilisation de ce service de réservation de piscine privée, les données suivantes sont collectées :
• Identité : prénom, nom
• Coordonnées : email, téléphone, adresse postale
• Données de connexion : mot de passe (stocké sous forme chiffrée et irréversible), historique de connexion
• Données de réservation : dates, horaires, nombre de participants, options choisies, montants payés
• Photos : état des lieux d'entrée et de sortie, signalement de dégâts
• Signature électronique apposée sur les états des lieux
• Avis et commentaires laissés sur la prestation

Aucune donnée bancaire (numéro de carte) n'est collectée ni stockée par ce site — les paiements sont traités directement par Stripe, prestataire de paiement certifié PCI-DSS.

3. FINALITÉS ET BASES LÉGALES

Chaque traitement repose sur une base légale précise :

• Gestion des réservations, des paiements et des états des lieux
  → Exécution du contrat de location (art. 6.1.b du RGPD)

• Envoi des emails et SMS liés à la réservation (confirmation, code de vérification, itinéraire d'accès, annulation)
  → Exécution du contrat (art. 6.1.b du RGPD)

• Établissement et conservation des factures
  → Obligation légale comptable (art. 6.1.c du RGPD)

• Avis, notation et attribution de codes promotionnels
  → Intérêt légitime à améliorer le service et fidéliser la clientèle (art. 6.1.f du RGPD)

• Sécurisation des accès (limitation des tentatives de connexion)
  → Intérêt légitime à protéger les comptes contre les accès frauduleux (art. 6.1.f du RGPD)

4. DESTINATAIRES ET SOUS-TRAITANTS

Vos données ne sont jamais vendues, louées ni cédées à des tiers à des fins commerciales.

Elles sont accessibles au responsable du traitement, et transmises aux sous-traitants techniques strictement nécessaires au fonctionnement du service, tous liés par un contrat conforme à l'article 28 du RGPD :

• Supabase — hébergement de la base de données (Union européenne)
• Vercel Inc. — hébergement du site (États-Unis, encadré par les clauses contractuelles types de la Commission européenne et le Data Privacy Framework)
• Stripe Payments Europe Ltd. — traitement des paiements (Irlande)
• Resend — acheminement des emails transactionnels
• Twilio Inc. — acheminement des SMS transactionnels (États-Unis, encadré par les clauses contractuelles types)

5. TRANSFERTS HORS UNION EUROPÉENNE

Certains sous-traitants (Vercel, Twilio) sont établis aux États-Unis. Ces transferts sont encadrés par les clauses contractuelles types adoptées par la Commission européenne et, le cas échéant, par la certification au Data Privacy Framework, garantissant un niveau de protection adéquat.

6. DURÉE DE CONSERVATION

• Compte client et données de réservation : 3 ans à compter de la dernière réservation
• Factures et pièces comptables : 10 ans (obligation légale, art. L123-22 du Code de commerce)
• États des lieux, photos et signatures : 1 an après la prestation, ou jusqu'à la résolution d'un litige en cours
• Tentatives de connexion échouées : 30 jours
• Avis et commentaires : jusqu'à leur suppression à votre demande

Au terme de ces durées, les données sont supprimées ou anonymisées.

7. VOS DROITS

Conformément au Règlement Général sur la Protection des Données (RGPD) et à la loi Informatique et Libertés, vous disposez des droits suivants :
• Droit d'accès : obtenir une copie des données vous concernant
• Droit de rectification : corriger des données inexactes
• Droit à l'effacement : demander la suppression de vos données
• Droit à la limitation du traitement
• Droit d'opposition, notamment aux traitements fondés sur l'intérêt légitime
• Droit à la portabilité : recevoir vos données dans un format structuré
• Droit de définir des directives sur le sort de vos données après votre décès

Vous pouvez exercer ces droits directement depuis votre espace "Mon compte" (consultation, modification, suppression de votre compte) ou en écrivant à ${EMAIL_CONTACT}. Une réponse vous sera apportée dans un délai maximum d'un mois.

Vous disposez également du droit d'introduire une réclamation auprès de la Commission Nationale de l'Informatique et des Libertés (CNIL) :
3 place de Fontenoy, TSA 80715, 75334 Paris Cedex 07 — www.cnil.fr

8. SÉCURITÉ

Les mesures suivantes protègent vos données : chiffrement des échanges (HTTPS), mots de passe stockés de façon chiffrée et irréversible, sessions signées côté serveur, restriction des accès à la base de données par politiques de sécurité, limitation automatique des tentatives de connexion, et absence totale de stockage de données bancaires.

9. COOKIES ET STOCKAGE LOCAL

Ce site n'utilise aucun cookie publicitaire, aucun traceur tiers et aucun outil de mesure d'audience.

Seuls sont utilisés les cookies et le stockage local strictement nécessaires au fonctionnement du service :
• Cookie de session : maintien de votre connexion pendant votre visite
• Stockage local : mémorisation de votre réservation en cours et de vos préférences d'affichage

Ces éléments sont exemptés de consentement préalable au titre de l'article 82 de la loi Informatique et Libertés et des recommandations de la CNIL, car strictement nécessaires à la fourniture du service que vous demandez. Aucun bandeau cookies n'est donc affiché.`;

const CGU_TEXTE = `CONDITIONS GÉNÉRALES DE VENTE ET D'UTILISATION

Dernière mise à jour : ${new Date().toLocaleDateString("fr-FR")}

1. IDENTIFICATION DU PRESTATAIRE

${SOCIETE_NOM} — ${SOCIETE_FORME}
Capital social : ${SOCIETE_CAPITAL}
Siège social : ${SOCIETE_ADRESSE}
${SOCIETE_RCS}
Email : ${EMAIL_CONTACT}${TELEPHONE_CONTACT ? " — Téléphone : " + TELEPHONE_CONTACT : ""}

2. OBJET

Les présentes conditions régissent l'utilisation du site mypiscineprivee.com et l'ensemble des réservations de créneaux de location de la piscine privée située à Écouflant (49000), conclues par son intermédiaire entre ${SOCIETE_NOM} et le client, personne physique non professionnelle.

3. RÉSERVATION

Toute réservation implique l'acceptation pleine et entière des présentes conditions ainsi que du règlement intérieur de la piscine, communiqué avant validation.

Le processus est le suivant : le client soumet une demande de réservation sans paiement ; le prestataire l'accepte ou la refuse ; en cas d'acceptation, un lien de paiement sécurisé est envoyé par email. Le créneau n'est définitivement réservé qu'après règlement effectif. En cas de demandes concurrentes sur un même créneau, le premier paiement reçu emporte la réservation, les autres demandes étant automatiquement annulées sans frais et leurs auteurs informés par email.

4. PRIX ET PAIEMENT

Les prix sont indiqués en euros toutes taxes comprises. Le tarif applicable est celui affiché au moment de la réservation.

Le paiement s'effectue en ligne par carte bancaire via Stripe, prestataire certifié PCI-DSS : l'intégralité du montant, ou sur option un acompte de 20 % en ligne avec solde en espèces le jour de la prestation.

Les remises éventuelles (fidélité, code promotionnel, extras offerts) sont appliquées automatiquement selon les conditions affichées lors de la réservation. Les codes promotionnels sont nominatifs, à usage unique, non cumulables entre eux et valables un mois à compter de leur attribution.

5. DROIT DE RÉTRACTATION

Conformément à l'article L221-28 12° du Code de la consommation, le droit de rétractation de quatorze jours ne s'applique pas aux prestations de services de loisirs fournies à une date ou selon une périodicité déterminée. La réservation d'un créneau de piscine à une date et une heure précises entre dans ce cadre : le client ne dispose donc pas de droit de rétractation.

Les conditions d'annulation prévues à l'article 6 s'appliquent en lieu et place.

6. ANNULATION ET REMBOURSEMENT

• Refus de la demande par le prestataire : aucune somme n'est prélevée, ou remboursement intégral si un paiement a déjà été effectué.
• Annulation à l'initiative du prestataire : remboursement intégral automatique.
• Annulation à la demande du client : remboursement selon le barème de pénalités affiché au moment de l'annulation, calculé en fonction du délai de prévenance.
• Réservation confirmée et non honorée sans annulation préalable : la prestation reste due intégralement.

Les remboursements sont effectués automatiquement sur le moyen de paiement d'origine. Le délai de mise à disposition des fonds dépend de l'établissement bancaire du client (généralement 5 à 10 jours ouvrés).

7. RESPONSABILITÉ ET SÉCURITÉ

La piscine est mise à disposition sans surveillance ni maître-nageur. Le client est seul responsable de la sécurité des personnes qu'il accompagne, en particulier des enfants mineurs et des personnes ne sachant pas nager, qui doivent faire l'objet d'une surveillance constante et rapprochée d'un adulte.

Le client s'engage à respecter le règlement intérieur, le nombre maximum de baigneurs indiqué et les consignes de sécurité communiquées. Le prestataire ne saurait être tenu responsable des dommages résultant du non-respect de ces règles.

8. ÉTAT DES LIEUX

Un état des lieux contradictoire est réalisé par le client à l'arrivée et au départ, via le site, avec signature électronique. Il porte sur la présence et le bon fonctionnement des équipements mis à disposition.

Tout dégât constaté au départ et non signalé par le client lors de l'état des lieux de sortie pourra lui être facturé sur justificatif.

9. DONNÉES PERSONNELLES

Le traitement des données personnelles est décrit dans la Politique de confidentialité, accessible depuis le pied de page du site.

10. RÉCLAMATIONS ET MÉDIATION

Toute réclamation doit être adressée en priorité à ${EMAIL_CONTACT}, afin de rechercher une solution amiable.

${MEDIATEUR_NOM
  ? `Conformément à l'article L612-1 du Code de la consommation, le client peut recourir gratuitement au médiateur de la consommation dont relève le prestataire :\n${MEDIATEUR_NOM}\n${MEDIATEUR_ADRESSE}\n${MEDIATEUR_SITE}`
  : `Conformément à l'article L612-1 du Code de la consommation, le client peut recourir gratuitement à un médiateur de la consommation en vue de la résolution amiable de tout litige. Les coordonnées du médiateur compétent sont communiquées sur demande à ${EMAIL_CONTACT}.`}

La Commission européenne met également à disposition une plateforme de règlement en ligne des litiges : https://ec.europa.eu/consumers/odr

11. DROIT APPLICABLE

Les présentes conditions sont soumises au droit français. À défaut de résolution amiable, tout litige relève de la compétence des juridictions françaises, dans les conditions prévues par le Code de la consommation pour les consommateurs.`;

const DECLARATION_ACCESSIBILITE = `DÉCLARATION D'ACCESSIBILITÉ

Dernière mise à jour : ${new Date().toLocaleDateString("fr-FR")}

1. ENGAGEMENT

${SOCIETE_NOM} s'engage à rendre le site mypiscineprivee.com accessible au plus grand nombre, y compris aux personnes en situation de handicap, conformément à l'esprit du Référentiel Général d'Amélioration de l'Accessibilité (RGAA) et des recommandations internationales WCAG 2.1 niveau AA.

2. MESURES MISES EN ŒUVRE

• Navigation complète au clavier : tous les boutons, champs, cases à cocher et systèmes de notation sont accessibles et activables sans souris (touches Tabulation, Entrée et Espace)
• Indicateur visuel de focus clairement visible sur chaque élément interactif
• Lien d'évitement permettant d'accéder directement au contenu principal
• Libellés explicites associés à chaque champ de formulaire
• Descriptions alternatives sur les images porteuses d'information
• Boutons à icône dotés d'un intitulé lisible par les lecteurs d'écran
• Contrastes de couleurs conformes au ratio minimal de 4,5:1 pour le texte
• Information jamais transmise par la couleur seule (un texte ou un symbole accompagne systématiquement les codes couleur)
• Structure de titres hiérarchisée et zones de page identifiées (en-tête, navigation, contenu principal, pied de page)
• Zones de clic suffisamment grandes sur mobile
• Compatibilité avec l'agrandissement du texte jusqu'à 200 %
• Respect du réglage système de réduction des animations

3. ÉTAT DE CONFORMITÉ

Ce site n'a pas fait l'objet d'un audit d'accessibilité externe certifié. Il est déclaré partiellement conforme aux recommandations WCAG 2.1 niveau AA, cette déclaration reposant sur une auto-évaluation.

Limitations connues à ce jour :
• La signature manuscrite de l'état des lieux nécessite l'usage d'un dispositif de pointage (doigt ou souris). Une alternative est disponible : contactez-nous pour réaliser l'état des lieux par un autre moyen.
• Certaines photographies téléversées par les utilisateurs ne disposent pas de description alternative détaillée.

4. RETOUR ET CONTACT

Si vous rencontrez une difficulté d'accès à un contenu ou à un service de ce site, contactez-nous à ${EMAIL_CONTACT}${TELEPHONE_CONTACT ? " ou au " + TELEPHONE_CONTACT : ""}. Nous vous répondrons dans les meilleurs délais et vous proposerons une alternative adaptée pour accéder à l'information ou finaliser votre réservation.

5. VOIE DE RECOURS

Si vous constatez un défaut d'accessibilité vous empêchant d'accéder à un contenu ou à une fonctionnalité et que vous n'obtenez pas de réponse satisfaisante de notre part, vous êtes en droit de saisir le Défenseur des droits :
• Formulaire en ligne : www.defenseurdesdroits.fr
• Par téléphone : 09 69 39 00 00
• Par courrier (gratuit, sans timbre) : Défenseur des droits, Libre réponse 71120, 75342 Paris CEDEX 07`;
// ─── Récapitulatif PDF de l'état des lieux ───────────────────────────────────
// Reprend la présentation du formulaire Swimmy : un tableau unique où chaque
// équipement est suivi sur quatre colonnes (présent/fonctionnel en début, puis
// en fin de location). Ouvre la fenêtre d'impression du navigateur, qui permet
// d'imprimer ou d'enregistrer en PDF. Aucune bibliothèque externe nécessaire.
function imprimerEtatDesLieux(r) {
  const dateFR = iso => iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
  const echapper = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const repEntree = r.edlEntree?.reponses || {};
  const repSortie = r.edlSortie?.reponses || {};
  // Union des éléments présents dans l'un ou l'autre des états des lieux
  const elements = [...new Set([...Object.keys(repEntree), ...Object.keys(repSortie)])];

  // Une case vide plutôt que "—" quand l'état des lieux n'a pas encore été fait
  const cellule = (rep, cle) => {
    if (!rep) return `<td class="c vide"></td>`;
    const val = rep[cle];
    return val ? `<td class="c">oui</td>` : `<td class="c ko"><strong>non</strong></td>`;
  };

  const lignes = elements.length
    ? elements.map(item => {
        const e = repEntree[item], s = repSortie[item];
        const anomalie = (e && (!e.present || !e.fonctionnel)) || (s && (!s.present || !s.fonctionnel));
        return `<tr class="${anomalie ? "anomalie" : ""}">
          <td class="equip">${echapper(item)}</td>
          ${cellule(e, "present")}${cellule(e, "fonctionnel")}
          ${cellule(s, "present")}${cellule(s, "fonctionnel")}
        </tr>`;
      }).join("")
    : `<tr><td colspan="5" class="vide">Aucun état des lieux enregistré.</td></tr>`;

  const commentaires = [
    r.edlEntree?.commentaire ? `<strong>À l'arrivée :</strong> ${echapper(r.edlEntree.commentaire)}` : "",
    r.edlSortie?.commentaire ? `<strong>Au départ :</strong> ${echapper(r.edlSortie.commentaire)}` : "",
    r.descriptionCasse ? `<strong>Dégât signalé :</strong> ${echapper(r.descriptionCasse)}` : "",
  ].filter(Boolean).join("<br>") || "<span class='vide'>Aucun commentaire.</span>";

  const caseSignature = (titre, moment, img, mention) =>
    `<td class="sign">
      <div class="sign-moment">${moment}</div>
      ${img ? `<img src="${img}" alt="Signature ${titre} ${moment}">` : `<div class="sign-vide">${mention || "—"}</div>`}
    </td>`;

  const mentionValidation = r.edlValideProprio ? `Validé le ${dateFR(r.edlValideDate)}` : "En attente";

  const photosDegats = (r.photosCasse || []).length
    ? `<h2>Photos des dégâts signalés</h2><div class="photos">${r.photosCasse.map((p, i) => `<img src="${p.url || p.data || p}" alt="Photo du dégât ${i + 1}">`).join("")}</div>`
    : "";

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Etat des lieux ${echapper(r.ref)}</title>
<style>
  @page { margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 11px; line-height: 1.45; }
  .entete { text-align: center; margin-bottom: 14px; }
  .marque { font-size: 22px; font-weight: bold; color: #07a0f2; }
  .soc { font-size: 9px; color: #666; margin-top: 3px; }
  h1 { font-size: 17px; text-align: center; letter-spacing: 1px; margin: 12px 0; color: #333; }
  h2 { font-size: 12px; color: #07a0f2; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  .infos td { border: 1px solid #999; padding: 6px 8px; }
  .infos .lib { background: #eef6fb; font-weight: bold; width: 34%; }
  .elems { margin-top: 12px; }
  .elems th { background: #07a0f2; color: #fff; border: 1px solid #999; padding: 6px 4px; font-size: 10px; }
  .elems td { border: 1px solid #999; padding: 6px 8px; }
  .elems td.equip { width: 34%; }
  .elems td.c { text-align: center; width: 16.5%; }
  .elems td.ko { color: #b02020; }
  tr.anomalie td.equip { background: #fff4f4; }
  .commentaires { border: 1px solid #999; border-top: none; padding: 8px; min-height: 34px; }
  .commentaires .lib { background: #07a0f2; color: #fff; font-weight: bold; padding: 5px 8px; margin: -8px -8px 8px; font-size: 10px; }
  .signatures { margin-top: 12px; }
  .signatures th { background: #07a0f2; color: #fff; border: 1px solid #999; padding: 5px; font-size: 11px; }
  .sign { border: 1px solid #999; width: 25%; height: 78px; vertical-align: top; padding: 4px; }
  .sign-moment { font-size: 8px; font-style: italic; color: #666; }
  .sign img { max-height: 52px; max-width: 100%; display: block; margin: 2px auto 0; }
  .sign-vide { font-size: 9px; color: #666; text-align: center; padding-top: 18px; }
  .vide { color: #888; font-style: italic; }
  .photos img { height: 100px; margin: 4px 6px 0 0; border: 1px solid #ccc; }
  footer { margin-top: 16px; border-top: 1px solid #ddd; padding-top: 6px; font-size: 8px; color: #888; text-align: center; }
</style></head><body>

<div class="entete">
  <div class="marque">My Piscine Privée</div>
  <div class="soc">${SOCIETE_NOM} — ${SOCIETE_FORME} au capital de ${SOCIETE_CAPITAL} · ${SOCIETE_ADRESSE} · ${SOCIETE_RCS}</div>
</div>

<h1>ÉTAT DES LIEUX</h1>

<table class="infos">
  <tr><td class="lib">Adresse de la réservation</td><td>${SOCIETE_ADRESSE}</td></tr>
  <tr><td class="lib">Date de la réservation</td><td>${echapper(r.date)} — de ${padH(r.heureDebut)} à ${padH(r.heureFin)}</td></tr>
  <tr><td class="lib">Référence</td><td>${echapper(r.ref)}</td></tr>
  <tr><td class="lib">Identité du propriétaire</td><td>${SOCIETE_DIRECTEUR_PUBLICATION}</td></tr>
  <tr><td class="lib">Identité du locataire</td><td>${echapper(r.nom)}, ${echapper(r.prenom)}${r.telephone ? " — " + echapper(r.telephone) : ""}</td></tr>
</table>

<table class="elems">
  <thead><tr>
    <th>Équipements</th>
    <th>Présents en début de location ?</th>
    <th>Fonctionnel en début de location ?</th>
    <th>Présents en fin de location ?</th>
    <th>Fonctionnel en fin de location ?</th>
  </tr></thead>
  <tbody>${lignes}</tbody>
</table>

<div class="commentaires">
  <div class="lib">Autres commentaires</div>
  ${commentaires}
</div>

<table class="signatures">
  <thead><tr><th colspan="2">Signature du propriétaire</th><th colspan="2">Signature du locataire</th></tr></thead>
  <tbody><tr>
    ${caseSignature("propriétaire", "En début de location", null, "Mise à disposition")}
    ${caseSignature("propriétaire", "En fin de location", null, mentionValidation)}
    ${caseSignature("locataire", "En début de location", r.edlEntree?.signature, null)}
    ${caseSignature("locataire", "En fin de location", r.edlSortie?.signature, null)}
  </tr></tbody>
</table>

${photosDegats}

<footer>
  État des lieux d'entrée signé le ${dateFR(r.edlEntree?.date)} · État des lieux de sortie signé le ${dateFR(r.edlSortie?.date)}<br>
  Document généré le ${new Date().toLocaleString("fr-FR")} depuis mypiscineprivee.com
</footer>
<script>window.onload = function () { window.print(); };<\/script>
</body></html>`;

  const fenetre = window.open("", "_blank");
  if (!fenetre) { alert("Le navigateur a bloqué l'ouverture de la fenêtre. Autorisez les fenêtres surgissantes pour ce site, puis réessayez."); return; }
  fenetre.document.write(html);
  fenetre.document.close();
}

// ─── Bannière « Installer l'application » ────────────────────────────────────
// Sur Android/Chrome, le navigateur propose un vrai bouton d'installation via
// l'événement beforeinstallprompt. Sur iPhone, Apple ne fournit pas cette API :
// on affiche donc la marche à suivre manuelle (Partager → Sur l'écran d'accueil).
// La bannière disparaît définitivement si l'utilisateur la ferme ou si
// l'application est déjà installée.
function BanniereInstallation() {
  const [invite, setInvite] = useState(null);   // événement différé (Android)
  const [visible, setVisible] = useState(false);
  const [iOS, setIOS] = useState(false);

  useEffect(() => {
    // Déjà installée : rien à proposer
    const dejaInstallee = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (dejaInstallee) return;
    try { if (localStorage.getItem("sp_install_masquee") === "1") return; } catch (e) { /* stockage indisponible */ }

    const estIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const estSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(window.navigator.userAgent);
    if (estIOS && estSafari) { setIOS(true); setVisible(true); return; }

    function surInvite(e) {
      e.preventDefault();          // on garde la main sur le moment de l'affichage
      setInvite(e);
      setVisible(true);
    }
    window.addEventListener("beforeinstallprompt", surInvite);
    return () => window.removeEventListener("beforeinstallprompt", surInvite);
  }, []);

  function masquer() {
    setVisible(false);
    try { localStorage.setItem("sp_install_masquee", "1"); } catch (e) { /* ignoré */ }
  }

  async function installer() {
    if (!invite) return;
    invite.prompt();
    await invite.userChoice;       // accepté ou refusé, on ne réaffiche pas
    setInvite(null);
    masquer();
  }

  if (!visible) return null;

  return (
    <div style={{ background:"#e8f6fe", border:"1.5px solid #b8e0f8", borderRadius:14, padding:"12px 14px", marginBottom:14, display:"flex", gap:12, alignItems:"center" }}>
      <div style={{ fontSize:26, flexShrink:0 }}>📲</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:700, color:"#07a0f2", fontSize:14 }}>Installer l'application</div>
        <div style={{ fontSize:12, color:"#6b7f8c", lineHeight:1.5 }}>
          {iOS
            ? <>Touchez <strong>Partager</strong> <span aria-hidden="true">⬆️</span> en bas de Safari, puis <strong>« Sur l'écran d'accueil »</strong>.</>
            : "Accédez à vos réservations en un geste, depuis votre écran d'accueil."}
        </div>
        {!iOS && (
          <button onClick={installer} style={{ marginTop:8, padding:"8px 18px", borderRadius:50, background:"#07a0f2", color:"#fff", border:"none", fontWeight:800, fontSize:13, cursor:"pointer" }}>
            Installer
          </button>
        )}
      </div>
      <button onClick={masquer} aria-label="Masquer cette proposition"
        style={{ background:"none", border:"none", color:"#6b7f8c", fontSize:18, cursor:"pointer", padding:4, alignSelf:"flex-start" }}>×</button>
    </div>
  );
}

// ─── SVG Vagues ───────────────────────────────────────────────────────────────
function Waves() {
  return (
    <svg viewBox="0 0 1440 80" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 50, marginTop: -2 }}>
      <path fill="#f8f9fa" d="M0,40 C240,80 480,0 720,40 C960,80 1200,0 1440,40 L1440,80 L0,80 Z" />
    </svg>
  );
}

function StepDot({ n, active, done }) {
  return (
    <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: done ? "#39b8f5" : active ? "#07a0f2" : "rgba(255,255,255,.25)", color: done || active ? "#fff" : "rgba(255,255,255,.6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>
      {done ? "✓" : n}
    </div>
  );
}

// Notation par étoiles — de vrais boutons radio accessibles : navigables au
// clavier (Tabulation + Entrée/Espace) et annoncés par les lecteurs d'écran.
function Stars({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Note de 1 à 5 étoiles" style={{ display: "flex", gap: 8, justifyContent: "center", margin: "8px 0" }}>
      {[1, 2, 3, 4, 5].map(s => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={s === value}
          aria-label={`${s} étoile${s > 1 ? "s" : ""} sur 5`}
          onClick={() => onChange(s)}
          style={{ fontSize: 34, cursor: "pointer", background: "none", border: "none", padding: 2, lineHeight: 1, filter: s <= value ? "none" : "grayscale(1) opacity(.35)", transition: "filter .2s" }}>
          <span aria-hidden="true">⭐</span>
        </button>
      ))}
    </div>
  );
}

function PhotoUploader({ label, photos, onChange, reference = null }) {
  const [renommageIdx, setRenommageIdx] = useState(null);
  const [nomTemp, setNomTemp] = useState("");

  function handleFiles(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    // Compression indispensable : les photos d'état des lieux sont nombreuses
    // et étaient enregistrées en pleine résolution, ce qui faisait échouer la sauvegarde.
    Promise.all(files.map(f => compresserImage(f).then(url => ({ name: f.name, url }))))
      .then(nw => onChange([...photos, ...nw]))
      .catch(err => {
        console.error("Compression photo échouée:", err);
        alert("Une des images n'a pas pu être traitée. Réessaie avec une autre photo.");
      });
    e.target.value = "";
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
          <div style={{ fontSize: 11, color: "#6b7f8c", marginBottom: 3, fontWeight: 600 }}>📸 Référence :</div>
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
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#39b8f5", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          📷 Prendre une photo
          <input type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={handleFiles} />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#07a0f2", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          🖼️ Choisir un fichier
          <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFiles} />
        </label>
      </div>
      {photos.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {photos.map((p, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ position: "relative" }}>
                <img src={p.url} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 7, border: "2px solid #39b8f5" }} />
                <button onClick={() => onChange(photos.filter((_, j) => j !== i))} title="Supprimer" style={{ position: "absolute", top: -5, right: -5, background: "#FF6B6B", color: "#fff", border: "none", borderRadius: "50%", width: 17, height: 17, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>×</button>
                {/* Remplacer la photo en place, sans devoir la supprimer puis recommencer */}
                <label title="Remplacer cette photo" style={{ position: "absolute", bottom: -5, right: -5, background: "#07a0f2", color: "#fff", borderRadius: "50%", width: 17, height: 17, cursor: "pointer", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  🔄
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                    const f = e.target.files[0];
                    if (!f) return;
                    compresserImage(f)
                      .then(url => onChange(photos.map((x, j) => j === i ? { ...x, url, name: f.name } : x)))
                      .catch(() => alert("Cette image n'a pas pu être traitée."));
                    e.target.value = "";
                  }} />
                </label>
              </div>
              {renommageIdx === i ? (
                <div style={{ display: "flex", gap: 3 }}>
                  <input autoFocus value={nomTemp} onChange={e => setNomTemp(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && validerRenommage(i)}
                    style={{ width: 64, fontSize: 10, padding: "2px 4px", borderRadius: 4, border: "1px solid #b8e0f8" }} />
                  <button onClick={() => validerRenommage(i)} style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4, background: "#07a0f2", color: "#fff", border: "none", cursor: "pointer" }}>✓</button>
                </div>
              ) : (
                <div onClick={() => { setRenommageIdx(i); setNomTemp(p.name || ""); }}
                  style={{ fontSize: 10, color: "#6b7f8c", cursor: "pointer", maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline dotted" }}
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
    // Dispo seulement s'il reste au moins 1h consécutive (2 créneaux de 30 min adjacents)
    const libres = ALL_SLOTS.filter(h => statuts[h] === "libre");
    const auMoinsUneHeure = libres.some(h => libres.includes(h + PAS));
    if (!auMoinsUneHeure) return "complet";
    return "dispo";
  }

  const couleurs = { passe: "#e0e0e0", ferme: "#f5d0d0", complet: "#fde8b0", dispo: "#c8f0ea", selected: "#07a0f2" };
  const textCouleurs = { passe: "#aaa", ferme: "#c0706a", complet: "#a07000", dispo: "#07a0f2", selected: "#fff" };

  return (
    <div>
      {/* Nav mois */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={() => setNav(n => { let m = n.month - 1, y = n.year; if (m < 0) { m = 11; y--; } return { year: y, month: m }; })}
          style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#07a0f2", padding: "4px 10px" }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#07a0f2" }}>{MOIS[month]} {year}</span>
        <button onClick={() => setNav(n => { let m = n.month + 1, y = n.year; if (m > 11) { m = 0; y++; } return { year: y, month: m }; })}
          style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#07a0f2", padding: "4px 10px" }}>›</button>
      </div>
      {/* Jours semaine */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 3 }}>
        {JOURS.map(j => <div key={j} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#6b7f8c", padding: "2px 0" }}>{j}</div>)}
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
                border: sel ? "2px solid #07a0f2" : "2px solid transparent",
                transition: "all .15s",
              }}>
              {d}
            </div>
          );
        })}
      </div>
      {/* Légende */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {[["#c8f0ea", "#07a0f2", "Disponible"], ["#fde8b0", "#a07000", "Complet"], ["#f5d0d0", "#c0706a", "Fermé"], ["#e0e0e0", "#aaa", "Passé"]].map(([bg, col, label]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: bg, border: `1px solid ${col}` }} />
            <span style={{ color: "#6b7f8c" }}>{label}</span>
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
        if (h === min - PAS || h === max + PAS) next = [...creneaux, h].sort((a,b)=>a-b);
        else return; // non adjacent
      }
    }
    // Vérifier les tampons vis-à-vis des autres réservations
    if (next.length > 0) {
      const allStatuts = statutHeures(disponibilites, reservations, date);
      const newMin = Math.min(...next), newMax = Math.max(...next);
      if (allStatuts[newMin - PAS] === "reserve" || allStatuts[newMax + PAS] === "reserve") return;
    }
    onToggle(next);
  }

  const coulBg = { libre: "#e8f6fe", reserve: "#ffd6d6", tampon: "#ffe8b0", ferme: "#f0f0f0" };
  const coulText = { libre: "#07a0f2", reserve: "#c0302a", tampon: "#a06000", ferme: "#bbb" };

  return (
    <div>
      <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 10, lineHeight: 1.5 }}>
        Chaque bouton représente un bloc de <strong style={{color:"#07a0f2"}}>30 minutes</strong> (ex. « 07:00→07:30 »). Sélectionnez-en plusieurs à la suite pour allonger votre session — minimum <strong style={{color:"#07a0f2"}}>1 heure</strong> (2 blocs).
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ALL_SLOTS.map(h => {
          const st = statuts[h];
          const sel = creneaux.includes(h);
          const isMin = sel && h === Math.min(...creneaux);
          const isMax = sel && h === Math.max(...creneaux);
          const cliquable = st === "libre";
          // Adjacent au bloc = peut être sélectionné
          const adjacent = creneaux.length > 0 && (h === Math.min(...creneaux) - PAS || h === Math.max(...creneaux) + PAS);

          let bg, color, border;
          if (sel) { bg = "#07a0f2"; color = "#fff"; border = "2px solid #07a0f2"; }
          else if (cliquable && (creneaux.length === 0 || adjacent)) { bg = "#e8f6fe"; color = "#07a0f2"; border = "2px dashed #39b8f5"; }
          else { bg = coulBg[st] || "#f0f0f0"; color = coulText[st] || "#bbb"; border = "2px solid transparent"; }

          return (
            <div key={h} onClick={() => toggleHeure(h)}
              style={{
                borderRadius: 10, padding: "8px 3px", fontSize: 10, fontWeight: 700,
                background: bg, color, border,
                cursor: cliquable ? "pointer" : "not-allowed",
                minWidth: 62, textAlign: "center",
                transition: "all .15s",
                position: "relative",
              }}>
              {padH(h)}<span style={{ fontWeight: 400, opacity: .75 }}>→{padH(h + PAS)}</span>
              <br />
              <span style={{ fontSize: 9, fontWeight: 400, opacity: .85 }}>
                {sel ? (isMin && isMax ? "✓ 30 min" : isMin ? "← début" : isMax ? "fin →" : "✓") : 
                 st === "reserve" ? "Réservé" : st === "tampon" ? "Indisponible" : st === "ferme" ? "Fermé" : "Libre"}
              </span>
              {h >= 20 && st === "libre" && !sel && <div style={{ fontSize: 8, color: "#f0a500", marginTop: 1 }}>+1€/h 🌙</div>}
            </div>
          );
        })}
      </div>
      {creneaux.length > 0 && (
        <div style={{ marginTop: 12, background: "#07a0f2", borderRadius: 10, padding: "10px 14px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {padH(Math.min(...creneaux))} → {padH(Math.max(...creneaux) + PAS)}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{formatDuree(creneaux.length)} sélectionnée{creneaux.length > 2 ? "s" : ""}</div>
          <button onClick={() => onToggle([])} style={{ background: "rgba(255,255,255,.25)", border: "none", color: "#fff", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Effacer</button>
        </div>
      )}
      {creneaux.length === 1 && (
        <div style={{ marginTop: 8, background: "#fff6e0", border: "1.5px solid #f0c040", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#a06000", fontWeight: 600 }}>
          ⏱ Réservation minimum : 1 heure. Ajoutez au moins un créneau de 30 minutes.
        </div>
      )}
      {/* Légende */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {[["#07a0f2","#fff","Sélectionné"],["#e8f6fe","#07a0f2","Libre"],["#ffd6d6","#c0302a","Réservé"],["#ffe8b0","#a06000","Indisponible"],["#f0f0f0","#bbb","Fermé"]].map(([bg,col,label])=>(
          <div key={label} style={{display:"flex",alignItems:"center",gap:3,fontSize:11}}>
            <div style={{width:12,height:12,borderRadius:3,background:bg,border:`1px solid ${col}`}}/>
            <span style={{color:"#6b7f8c"}}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const card = { background: "#fff", borderRadius: 20, boxShadow: "0 4px 24px rgba(0,0,0,.06)", padding: "20px 16px", marginBottom: 14 };
const btnP = { background: "#07a0f2", color: "#fff", border: "none", borderRadius: 50, padding: "14px 24px", fontSize: 15, fontWeight: 800, cursor: "pointer", width: "100%", marginTop: 8, boxShadow: "0 4px 14px rgba(7,160,242,.30)" };
const btnS = { background: "#fff", color: "#07a0f2", border: "2px solid #07a0f2", borderRadius: 50, padding: "12px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%", marginTop: 8 };
const lbl = { fontSize: 13, fontWeight: 600, color: "#07a0f2", marginBottom: 4, display: "block" };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 15, border: "1.5px solid #b8e0f8", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: "Inter,sans-serif" };

// ─── Composant Gestion Annonce ───────────────────────────────────────────────
function GestionAnnonce({ annonce, setAnnonce, onVoir }) {
  const [ongletAnnonce, setOngletAnnonce] = useState("infos");
  const tabStyle = t => ({ flex:1, padding:"8px 0", borderRadius:7, fontSize:11, fontWeight:600, border:"none", cursor:"pointer", background:ongletAnnonce===t?"#07a0f2":"#e8f4f7", color:ongletAnnonce===t?"#fff":"#07a0f2" });

  // Brouillon local : les modifications ne sont appliquées qu'au clic sur "Enregistrer"
  const [brouillon, setBrouillon] = useState(annonce);
  // États du petit formulaire d'ajout d'équipement personnalisé
  const [eqNouveauLabel, setEqNouveauLabel] = useState("");
  const [eqNouvelEmoji, setEqNouvelEmoji] = useState("🅿️");
  const [eqEmojiOuvert, setEqEmojiOuvert] = useState(false);
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
        style={{ flex:1, padding:"12px", borderRadius:10, background: (modifie && !enregistrementEnCours) ? "#07a0f2" : "#e0e0e0", color: (modifie && !enregistrementEnCours) ? "#fff" : "#aaa", border:"none", fontWeight:700, fontSize:14, cursor: (modifie && !enregistrementEnCours) ? "pointer" : "not-allowed", transition:"all .2s" }}>
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
        <div style={{ background:"#e8f6fe", border:"1.5px solid #39b8f5", borderRadius:10, padding:"10px 14px", marginBottom:12, color:"#07a0f2", fontWeight:600, fontSize:13, display:"flex", alignItems:"center", gap:8 }}>
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
        <button onClick={onVoir} style={{ flex:1, padding:"9px", borderRadius:9, background:"#39b8f5", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
          👁 Voir l'annonce
        </button>
        <button onClick={()=>setBrouillon(a=>({...a,ouvert:!a.ouvert}))}
          style={{ flex:1, padding:"9px", borderRadius:9, background:brouillon.ouvert?"#FF6B6B":"#39b8f5", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
          {brouillon.ouvert?"✗ Fermer l'annonce":"✓ Ouvrir l'annonce"}
        </button>
      </div>

      {/* ── INFOS ── */}
      {ongletAnnonce==="infos" && (
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"20px 16px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", fontWeight:700, marginBottom:12 }}>📝 Informations générales</div>
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Titre</label>
            <input style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:14, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.titre} onChange={e=>setBrouillon(a=>({...a,titre:e.target.value}))}/>
          </div>
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Description</label>
            <textarea style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:12, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box", height:180, resize:"vertical", lineHeight:1.6 }} value={brouillon.description} onChange={e=>setBrouillon(a=>({...a,description:e.target.value}))}/>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:8, marginBottom:10 }}>
            <div><label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Adresse</label><input style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.adresse} onChange={e=>setBrouillon(a=>({...a,adresse:e.target.value}))}/></div>
            <div><label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>CP</label><input style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.codePostal} onChange={e=>setBrouillon(a=>({...a,codePostal:e.target.value}))}/></div>
            <div><label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Ville</label><input style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.ville} onChange={e=>setBrouillon(a=>({...a,ville:e.target.value}))}/></div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:6, display:"block" }}>Capacité maximale</label>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <button onClick={()=>setBrouillon(a=>({...a,capaciteMax:Math.max(1,a.capaciteMax-1)}))} style={{ width:32,height:32,borderRadius:"50%",border:"2px solid #07a0f2",background:"#fff",color:"#07a0f2",fontSize:18,fontWeight:700,cursor:"pointer" }}>−</button>
              <span style={{ fontWeight:700, fontSize:18 }}>{brouillon.capaciteMax} pers.</span>
              <button onClick={()=>setBrouillon(a=>({...a,capaciteMax:a.capaciteMax+1}))} style={{ width:32,height:32,borderRadius:"50%",border:"none",background:"#07a0f2",color:"#fff",fontSize:18,fontWeight:700,cursor:"pointer" }}>+</button>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Vis-à-vis</label>
              <select style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.visAVis} onChange={e=>setBrouillon(a=>({...a,visAVis:e.target.value}))}>
                <option value="aucun">Aucun</option><option value="leger">Léger</option><option value="complet">Complet</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Présence</label>
              <select style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.presenceProprietaire} onChange={e=>setBrouillon(a=>({...a,presenceProprietaire:e.target.value}))}>
                <option value="oui">Oui</option><option value="non">Non</option><option value="occasionnellement">Occasionnellement</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Entretien</label>
              <select style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.produitEntretien} onChange={e=>setBrouillon(a=>({...a,produitEntretien:e.target.value}))}>
                <option value="chlore">Chlore</option><option value="sel">Sel</option><option value="brome">Brome</option><option value="autres">Autres</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:8, display:"block" }}>Équipements</label>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              {Object.entries(EQUIPEMENTS_LABELS).map(([k,[emoji,label]])=>(
                <label key={k} style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer", padding:"7px 9px", borderRadius:8, background:brouillon.equipements[k]?"#e8f6fe":"#f5f5f5", border:`1px solid ${brouillon.equipements[k]?"#39b8f5":"#e0e0e0"}` }}>
                  <input type="checkbox" checked={!!brouillon.equipements[k]} onChange={e=>setBrouillon(a=>({...a,equipements:{...a.equipements,[k]:e.target.checked}}))} style={{ accentColor:"#07a0f2" }}/>
                  <span style={{ fontSize:12, fontWeight:600, color:brouillon.equipements[k]?"#07a0f2":"#888" }}>{emoji} {label}</span>
                </label>
              ))}
              {/* Équipements personnalisés ajoutés par la propriétaire (ex : parking) */}
              {(brouillon.equipementsPerso||[]).map((eq,i)=>(
                <label key={eq.id} style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer", padding:"7px 9px", borderRadius:8, background:eq.actif?"#e8f6fe":"#f5f5f5", border:`1px solid ${eq.actif?"#39b8f5":"#e0e0e0"}` }}>
                  <input type="checkbox" checked={!!eq.actif} onChange={e=>setBrouillon(a=>({...a,equipementsPerso:(a.equipementsPerso||[]).map((x,j)=>j===i?{...x,actif:e.target.checked}:x)}))} style={{ accentColor:"#07a0f2" }}/>
                  <span style={{ fontSize:12, fontWeight:600, color:eq.actif?"#07a0f2":"#888", flex:1 }}>{eq.emoji} {eq.label}</span>
                  <button type="button" onClick={ev=>{ ev.preventDefault(); if(window.confirm(`Supprimer l'équipement "${eq.label}" ?`)) setBrouillon(a=>({...a,equipementsPerso:(a.equipementsPerso||[]).filter((_,j)=>j!==i)})); }}
                    style={{ background:"none", border:"none", color:"#FF6B6B", cursor:"pointer", fontSize:13, fontWeight:700, padding:0 }}>×</button>
                </label>
              ))}
            </div>
            {/* Formulaire d'ajout d'un équipement personnalisé */}
            <div style={{ background:"#f8f9fa", borderRadius:10, padding:"10px 12px", marginTop:8 }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#07a0f2", marginBottom:6 }}>➕ Ajouter un équipement (ex : Parking extérieur)</div>
              <div style={{ display:"flex", gap:7, alignItems:"center" }}>
                <button type="button" onClick={()=>setEqEmojiOuvert(v=>!v)} style={{ width:38, height:38, borderRadius:8, border:"1.5px solid #b8e0f8", background:"#fff", fontSize:18, cursor:"pointer" }}>{eqNouvelEmoji}</button>
                <input value={eqNouveauLabel} onChange={e=>setEqNouveauLabel(e.target.value)} placeholder="Nom de l'équipement" style={{ flex:1, padding:"9px 12px", borderRadius:8, border:"1.5px solid #b8e0f8", fontSize:13 }}/>
                <button type="button" onClick={()=>{
                  const label = eqNouveauLabel.trim();
                  if (!label) return;
                  setBrouillon(a=>({...a, equipementsPerso:[...(a.equipementsPerso||[]), { id:"eqp_"+Date.now(), emoji:eqNouvelEmoji, label, actif:true }]}));
                  setEqNouveauLabel(""); setEqEmojiOuvert(false);
                }} style={{ padding:"9px 16px", borderRadius:8, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>Ajouter</button>
              </div>
              {eqEmojiOuvert && <SelecteurEmoji onChoisir={em=>{ setEqNouvelEmoji(em); setEqEmojiOuvert(false); }}/>}
            </div>
          </div>
          <div>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Délai minimum avant réservation (heures)</label>
            <input type="number" min={0} max={72} style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:14, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.delaiReservation} onChange={e=>setBrouillon(a=>({...a,delaiReservation:+e.target.value}))}/>
          </div>
        </div>
      )}
      {ongletAnnonce==="infos" && <BoutonSauvegarde/>}

      {/* ── PHOTOS ── */}
      {ongletAnnonce==="photos" && (
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"20px 16px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", fontWeight:700, marginBottom:6 }}>📷 Photos</div>
          <div style={{ fontSize:13, color:"#6b7f8c", marginBottom:12 }}>⭐ = photo principale · ▲▼ = réordonner · 🗑 = supprimer</div>
          <label style={{ display:"inline-block", padding:"10px 18px", background:"#07a0f2", color:"#fff", borderRadius:9, cursor:"pointer", fontSize:14, fontWeight:700, marginBottom:14 }}>
            📷 Ajouter des photos
            <input type="file" multiple accept="image/*" style={{ display:"none" }} onChange={e=>{
              const files=Array.from(e.target.files);
              if (!files.length) return;
              // Compression avant enregistrement : sans elle, les photos brutes
              // dépassent la taille acceptée par la base et rien n'est conservé.
              Promise.all(files.map(f=>compresserImage(f))).then(urls=>{
                setBrouillon(a=>({...a,photos:[...a.photos,...urls],photoUne:a.photoUne??0}));
              }).catch(err=>{
                console.error("Compression photo échouée:", err);
                alert("Une des images n'a pas pu être traitée. Vérifie qu'il s'agit bien d'une photo (JPEG, PNG ou HEIC converti).");
              });
              e.target.value = ""; // permet de re-sélectionner le même fichier
            }}/>
          </label>
          {brouillon.photos.length===0 ? (
            <div style={{ color:"#6b7f8c", fontSize:13, textAlign:"center", padding:"20px", border:"2px dashed #b8e0f8", borderRadius:10 }}>
              Aucune photo ajoutée
            </div>
          ) : brouillon.photos.map((url,i)=>(
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px", borderRadius:10, background:"#f0f9ff", marginBottom:8, border:`2px solid ${brouillon.photoUne===i?"#f0c040":"#e0e0e0"}` }}>
              <img src={url} alt="" style={{ width:70,height:60,objectFit:"cover",borderRadius:8,flexShrink:0 }}/>
              <div style={{ flex:1, fontSize:12, color:"#6b7f8c" }}>
                Photo {i+1}{brouillon.photoUne===i?" ⭐":""}
              </div>
              <div style={{ display:"flex", gap:4 }}>
                <button title="Photo principale" onClick={()=>setBrouillon(a=>({...a,photoUne:i}))} style={{ width:30,height:30,borderRadius:7,border:"none",background:brouillon.photoUne===i?"#f0c040":"#e8f4f7",cursor:"pointer",fontSize:14 }}>⭐</button>
                <button title="Monter" onClick={()=>setBrouillon(a=>{if(i===0)return a;const p=[...a.photos];[p[i-1],p[i]]=[p[i],p[i-1]];return{...a,photos:p,photoUne:a.photoUne===i?i-1:a.photoUne===i-1?i:a.photoUne};})} disabled={i===0} style={{ width:30,height:30,borderRadius:7,border:"none",background:"#e8f4f7",cursor:i===0?"not-allowed":"pointer",fontSize:12,opacity:i===0?.4:1 }}>▲</button>
                <button title="Descendre" onClick={()=>setBrouillon(a=>{if(i===a.photos.length-1)return a;const p=[...a.photos];[p[i],p[i+1]]=[p[i+1],p[i]];return{...a,photos:p,photoUne:a.photoUne===i?i+1:a.photoUne===i+1?i:a.photoUne};})} disabled={i===brouillon.photos.length-1} style={{ width:30,height:30,borderRadius:7,border:"none",background:"#e8f4f7",cursor:i===brouillon.photos.length-1?"not-allowed":"pointer",fontSize:12,opacity:i===brouillon.photos.length-1?.4:1 }}>▼</button>
                <button title="Supprimer" onClick={()=>setBrouillon(a=>{const p=a.photos.filter((_,j)=>j!==i);return{...a,photos:p,photoUne:p.length===0?null:a.photoUne===i?0:a.photoUne>i?a.photoUne-1:a.photoUne};})} style={{ width:30,height:30,borderRadius:7,border:"none",background:"#fff0f0",color:"#FF6B6B",cursor:"pointer",fontSize:14 }}aria-label={`Supprimer la photo ${i+1}`}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {ongletAnnonce==="photos" && <BoutonSauvegarde/>}

      {/* ── RÈGLEMENT ── */}
      {ongletAnnonce==="reglement" && (
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"20px 16px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", fontWeight:700, marginBottom:12 }}>📋 Règlement & autorisations</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:8, marginBottom:14 }}>
            {[["enfants","👶","Convient aux enfants (0-12 ans)"],["naturisme","🧘","Naturisme autorisé"],
              ["burkini","👙","Burkini autorisé"],["evenements","🎉","Événements autorisés"],
              ["alcool","🍷","Alcool autorisé"],["fumeur","🚬","Espace fumeur"],
              ["animaux","🐾","Animaux acceptés"],["musique","🎵","Musique autorisée"]].map(([k,emoji,label])=>(
              <label key={k} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", padding:"10px 12px", borderRadius:10, background:brouillon.reglement[k]?"#e8f6fe":"#f5f5f5", border:`1.5px solid ${brouillon.reglement[k]?"#39b8f5":"#e0e0e0"}` }}>
                <input type="checkbox" checked={!!brouillon.reglement[k]} onChange={e=>setBrouillon(a=>({...a,reglement:{...a.reglement,[k]:e.target.checked}}))} style={{ width:18,height:18,accentColor:"#07a0f2" }}/>
                <span style={{ fontSize:16 }}>{emoji}</span>
                <span style={{ fontSize:13, fontWeight:600, color:brouillon.reglement[k]?"#07a0f2":"#888" }}>{label}</span>
                <span style={{ marginLeft:"auto", fontSize:16 }}>{brouillon.reglement[k]?"✅":"❌"}</span>
              </label>
            ))}
          </div>
          <div style={{ marginBottom:10 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Délai minimum avant réservation (heures)</label>
            <input type="number" min={0} max={72} style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:14, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }} value={brouillon.delaiReservation} onChange={e=>setBrouillon(a=>({...a,delaiReservation:+e.target.value}))}/>
          </div>
          <div>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:8, display:"block" }}>Précisions supplémentaires (règles de vie sur place)</label>
            {brouillon.precisions.map((p, i) => (
              <div key={p.id} style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:8, background:"#f5f5f5", borderRadius:9, padding:"9px 10px" }}>
                <span style={{ fontSize:18, flexShrink:0 }}>{p.emoji}</span>
                <textarea value={p.texte} onChange={e=>setBrouillon(a=>({...a, precisions:a.precisions.map((x,j)=>j===i?{...x,texte:e.target.value}:x)}))}
                  style={{ flex:1, padding:"6px 8px", borderRadius:6, fontSize:12, border:"1px solid #d8d8d8", outline:"none", background:"#fff", boxSizing:"border-box", resize:"vertical", minHeight:36, lineHeight:1.5 }}/>
                <button onClick={()=>setBrouillon(a=>({...a, precisions:a.precisions.filter((_,j)=>j!==i)}))}
                  style={{ width:28, height:28, borderRadius:6, border:"none", background:"#fff0f0", color:"#FF6B6B", cursor:"pointer", fontSize:13, flexShrink:0 }}aria-label={`Supprimer la précision ${i+1}`}>🗑</button>
              </div>
            ))}
            {/* Ajout nouvelle règle */}
            <div style={{ display:"flex", gap:8, marginTop:10, background:"#f0f9ff", borderRadius:9, padding:"10px", border:"1.5px dashed #39b8f5" }}>
              <input value={nouvellePrecision.emoji} onChange={e=>setNouvellePrecision(p=>({...p,emoji:e.target.value}))} maxLength={2}
                style={{ width:42, padding:"6px", borderRadius:6, fontSize:16, textAlign:"center", border:"1px solid #b8e0f8", boxSizing:"border-box" }}/>
              <input value={nouvellePrecision.texte} onChange={e=>setNouvellePrecision(p=>({...p,texte:e.target.value}))}
                placeholder="Nouvelle règle..." style={{ flex:1, padding:"6px 8px", borderRadius:6, fontSize:12, border:"1px solid #b8e0f8", boxSizing:"border-box" }}/>
              <button onClick={()=>{
                if(!nouvellePrecision.texte.trim()) return;
                setBrouillon(a=>({...a, precisions:[...a.precisions, {id:"p"+Date.now(), ...nouvellePrecision}]}));
                setNouvellePrecision({emoji:"📌", texte:""});
              }} style={{ padding:"6px 14px", borderRadius:6, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer", flexShrink:0 }}>+ Ajouter</button>
            </div>
          </div>
          <BoutonSauvegarde/>
        </div>
      )}

      {/* ── SÉCURITÉ ── */}
      {ongletAnnonce==="securite" && (
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"20px 16px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", fontWeight:700, marginBottom:6 }}>🛡️ Dispositifs de sécurité</div>
          <div style={{ fontSize:12, color:"#6b7f8c", marginBottom:14, lineHeight:1.6 }}>
            Conformité <strong>loi du 03/01/2003</strong> — cochez les dispositifs installés :
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:8 }}>
            {[["barriere","🚧","Barrière de protection"],["bache","🟦","Bâche de sécurité"],
              ["abri","🏠","Abri de piscine"],["alarme","🔔","Alarme de sécurité"]].map(([k,emoji,label])=>(
              <label key={k} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", padding:"12px 14px", borderRadius:10, background:brouillon.dispositifs[k]?"#e8f6fe":"#f5f5f5", border:`1.5px solid ${brouillon.dispositifs[k]?"#39b8f5":"#e0e0e0"}` }}>
                <input type="checkbox" checked={!!brouillon.dispositifs[k]} onChange={e=>setBrouillon(a=>({...a,dispositifs:{...a.dispositifs,[k]:e.target.checked}}))} style={{ width:18,height:18,accentColor:"#07a0f2" }}/>
                <span style={{ fontSize:20 }}>{emoji}</span>
                <span style={{ fontSize:13, fontWeight:600, color:brouillon.dispositifs[k]?"#07a0f2":"#888" }}>{label}</span>
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
  const card = { background: "#fff", borderRadius: 20, boxShadow: "0 4px 24px rgba(0,0,0,.06)", padding: "20px 16px", marginBottom: 14 };

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
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#07a0f2", marginBottom:14, fontWeight:700 }}>📊 Tableau de bord</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:4 }}>
          {[["📅","Réservations",nbRes],["💶","CA total",formatEur(caTotal)],["🛒","Panier moyen",formatEur(panierMoyen)],["⭐","Satisfaction",noteMoyenneLocataire?`${noteMoyenneLocataire}/5`:"—"]].map(([emoji,label,val])=>(
            <div key={label} style={{ background:"#f0f9ff", borderRadius:10, padding:"12px 10px", border:"1px solid #b8e0f8", textAlign:"center" }}>
              <div style={{ fontSize:22 }}>{emoji}</div>
              <div style={{ fontWeight:700, fontSize:16, color:"#07a0f2", marginTop:2 }}>{val}</div>
              <div style={{ fontSize:10, color:"#6b7f8c", marginTop:1 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Taux d'acceptation / refus / annulation */}
      <div style={card}>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", marginBottom:12, fontWeight:700 }}>📋 Demandes de réservation</div>
        {nbEnAttente > 0 && (
          <div style={{ background:"#fff8e1", borderRadius:8, padding:"8px 12px", fontSize:12, color:"#a06000", fontWeight:600, marginBottom:12 }}>
            ⏳ {nbEnAttente} demande{nbEnAttente>1?"s":""} actuellement en attente
          </div>
        )}
        {nbTraitees === 0 ? (
          <div style={{ color:"#6b7f8c", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucune demande traitée pour l'instant.</div>
        ) : (
          <>
            <div style={{ display:"flex", height:28, borderRadius:10, overflow:"hidden", marginBottom:12 }}>
              {pctAcceptees>0 && <div style={{ width:`${pctAcceptees}%`, background:"#39b8f5", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctAcceptees}%</div>}
              {pctRefusees>0 && <div style={{ width:`${pctRefusees}%`, background:"#f0c040", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctRefusees}%</div>}
              {pctAnnulees>0 && <div style={{ width:`${pctAnnulees}%`, background:"#FF6B6B", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctAnnulees}%</div>}
            </div>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:8 }}>
              {[["#39b8f5","Acceptées",nbAcceptees],["#f0c040","Refusées",nbRefusees],["#FF6B6B","Annulées",nbAnnulees]].map(([bg,label,nb])=>(
                <div key={label} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:12, height:12, borderRadius:3, background:bg }}/>
                  <span style={{ fontSize:12, color:"#2C3E50" }}>{label} : <strong>{nb}</strong></span>
                </div>
              ))}
            </div>
            {nbAnnulees > 0 && (
              <div style={{ fontSize:11, color:"#6b7f8c", marginBottom:10 }}>
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
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", marginBottom:12, fontWeight:700 }}>⭐ Satisfaction des locataires</div>
        {avisPrestation.length === 0 ? (
          <div style={{ color:"#6b7f8c", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucun avis laissé pour l'instant.</div>
        ) : (
          <>
            <div style={{ textAlign:"center", marginBottom:14 }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:32, fontWeight:700, color:"#07a0f2" }}>{noteMoyenneLocataire}<span style={{fontSize:16,color:"#aaa"}}>/5</span></div>
              <div style={{ fontSize:12, color:"#6b7f8c" }}>{avisPrestation.length} avis sur la prestation</div>
            </div>
            {repartitionAvis.map(({note,nb}) => (
              <div key={note} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                <span style={{ fontSize:12, color:"#6b7f8c", width:30 }}>{note} ⭐</span>
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
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", marginBottom:12, fontWeight:700 }}>📈 Évolution du chiffre d'affaires</div>
        {moisSorted.length === 0 ? (
          <div style={{ color:"#6b7f8c", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucune donnée disponible.</div>
        ) : (
          <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:140, overflowX:"auto", paddingBottom:4 }}>
            {moisSorted.map(m => (
              <div key={m} style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0, minWidth:44 }}>
                <div style={{ fontSize:10, color:"#07a0f2", fontWeight:700, marginBottom:3 }}>{formatEur(caParMois[m])}</div>
                <div style={{ width:32, height:Math.max(4,(caParMois[m]/maxCaMois)*90), background:"#07a0f2", borderRadius:"6px 6px 0 0" }}/>
                <div style={{ fontSize:11, color:"#6b7f8c", marginTop:5 }}>{labelMois(m)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Utilisation des extras */}
      <div style={card}>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", marginBottom:12, fontWeight:700 }}>🎁 Utilisation des extras</div>
        {totalUtilisationsExtras === 0 ? (
          <div style={{ color:"#6b7f8c", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucun extra utilisé pour l'instant.</div>
        ) : (
          extrasUtilisation.filter(e=>e.nbUtilisations>0).map(e => (
            <div key={e.id} style={{ marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3 }}>
                <span style={{ fontWeight:600, color:"#2C3E50" }}>{e.emoji} {e.nom}</span>
                <span style={{ color:"#07a0f2", fontWeight:700 }}>{e.nbUtilisations}× · {formatEur(e.revenu)}</span>
              </div>
              <div style={{ height:7, background:"#e8f4f7", borderRadius:4, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${(e.nbUtilisations/totalUtilisationsExtras)*100}%`, background:"#07a0f2", borderRadius:4 }}/>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Répartition mode de paiement */}
      <div style={card}>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", marginBottom:12, fontWeight:700 }}>💳 Modes de paiement</div>
        {totalPaiements === 0 ? (
          <div style={{ color:"#6b7f8c", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucune donnée disponible.</div>
        ) : (
          <>
            <div style={{ display:"flex", height:28, borderRadius:10, overflow:"hidden", marginBottom:12 }}>
              {pctCB>0 && <div style={{ width:`${pctCB}%`, background:"#07a0f2", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctCB}%</div>}
              {pctEspeces>0 && <div style={{ width:`${pctEspeces}%`, background:"#39b8f5", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctEspeces}%</div>}
            </div>
            <div style={{ display:"flex", gap:16, marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:12, height:12, borderRadius:3, background:"#07a0f2" }}/>
                <span style={{ fontSize:12, color:"#2C3E50" }}>💳 Carte : <strong>{nbCB}</strong></span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:12, height:12, borderRadius:3, background:"#39b8f5" }}/>
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
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", marginBottom:12, fontWeight:700 }}>📍 Origine géographique</div>
        {totalGeo === 0 ? (
          <div style={{ color:"#6b7f8c", fontSize:13, textAlign:"center", padding:"12px 0" }}>
            Aucune donnée. Les locataires inscrits avec adresse apparaîtront ici.
          </div>
        ) : (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
              {[["🏙️","Villes",villesSorted.length],["🗺️","Départements",deptSorted.length],["👤","Géolocalisés",totalGeo],["📌","Ville #1",villesSorted[0]?.[0]?.split(" ").slice(1).join(" ")||"—"]].map(([emoji,label,val])=>(
                <div key={label} style={{ background:"#f0f9ff", borderRadius:9, padding:"10px", border:"1px solid #b8e0f8", textAlign:"center" }}>
                  <div style={{ fontSize:18 }}>{emoji}</div>
                  <div style={{ fontWeight:700, fontSize:14, color:"#07a0f2" }}>{val}</div>
                  <div style={{ fontSize:10, color:"#6b7f8c" }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#07a0f2", marginBottom:8 }}>Par ville</div>
              {villesSorted.map(([ville,nb])=>{
                const pct=Math.round(nb/totalGeo*100);
                return (
                  <div key={ville} style={{ marginBottom:8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3 }}>
                      <span style={{ fontWeight:600, color:"#2C3E50" }}>{ville}</span>
                      <span style={{ color:"#07a0f2", fontWeight:700 }}>{nb} · {pct}%</span>
                    </div>
                    <div style={{ height:7, background:"#e8f4f7", borderRadius:4, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:"#07a0f2", borderRadius:4 }}/>
                    </div>
                  </div>
                );
              })}
            </div>
            {deptSorted.length>0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {deptSorted.map(([dept,nb])=>(
                  <div key={dept} style={{ background:"#07a0f2", color:"#fff", borderRadius:8, padding:"6px 12px", fontSize:13, fontWeight:700, textAlign:"center" }}>
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
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", marginBottom:12, fontWeight:700 }}>👥 Répartition des participants</div>
        {totalPersonnes === 0 ? (
          <div style={{ color:"#6b7f8c", fontSize:13, textAlign:"center", padding:"12px 0" }}>Aucune donnée disponible.</div>
        ) : (
          <>
            <div style={{ display:"flex", height:28, borderRadius:10, overflow:"hidden", marginBottom:12 }}>
              {pctA>0 && <div style={{ width:`${pctA}%`, background:"#07a0f2", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctA}%</div>}
              {pctE>0 && <div style={{ width:`${pctE}%`, background:"#39b8f5", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>{pctE}%</div>}
              {pctB>0 && <div style={{ width:`${pctB}%`, background:"#ffe082", display:"flex", alignItems:"center", justifyContent:"center", color:"#a06000", fontSize:11, fontWeight:700 }}>{pctB}%</div>}
            </div>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:12 }}>
              {[["#07a0f2","Adultes (12+)",totalAdultes,pctA],["#39b8f5","Enfants (3-11)",totalEnfants12,pctE],["#ffe082","Moins de 3 ans",totalMoins3,pctB]].map(([bg,label,nb,pct])=>(
                <div key={label} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:12, height:12, borderRadius:3, background:bg }}/>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:"#2C3E50" }}>{label}</div>
                    <div style={{ fontSize:11, color:"#6b7f8c" }}>{nb} pers. · {pct}%</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background:"#f0f9ff", borderRadius:8, padding:"9px 12px", fontSize:13, color:"#07a0f2", fontWeight:600, textAlign:"center" }}>
              Total : {totalPersonnes} participant{totalPersonnes>1?"s":""} sur {nbRes} réservation{nbRes>1?"s":""}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Bouton flottant WhatsApp ───────────────────────────────────────────────
// Contact direct pour les clients, en alternative à l'email. Le numéro et le
// message pré-rempli sont ceux de la propriétaire (AB Kaizen / My Piscine Privée).
const WHATSAPP_NUMERO = "33679419114"; // 06 79 41 91 14, format international sans le 0 initial
const WHATSAPP_MESSAGE = "Bonjour, j'ai une question concernant My Piscine Privée 🏊";

function BoutonWhatsApp() {
  const [visible, setVisible] = useState(true);
  const [pos, setPos] = useState(null); // { x, y } en pixels depuis le coin haut-gauche ; null = position par défaut (bas-droite)
  const glisse = useRef({ actif: false, decalX: 0, decalY: 0, depart: { x: 0, y: 0 }, bouge: false });

  function demarrerGlisse(e) {
    const point = e.touches ? e.touches[0] : e;
    const rect = e.currentTarget.getBoundingClientRect();
    glisse.current = {
      actif: true, decalX: point.clientX - rect.left, decalY: point.clientY - rect.top,
      depart: { x: point.clientX, y: point.clientY }, bouge: false,
    };
    window.addEventListener("mousemove", surGlisse);
    window.addEventListener("mouseup", finGlisse);
    window.addEventListener("touchmove", surGlisse, { passive: false });
    window.addEventListener("touchend", finGlisse);
  }
  function surGlisse(e) {
    if (!glisse.current.actif) return;
    if (e.cancelable) e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    // Glissement réel seulement au-delà d'un petit seuil (évite les faux positifs sur un simple clic)
    const distance = Math.hypot(point.clientX - glisse.current.depart.x, point.clientY - glisse.current.depart.y);
    if (distance > 5) glisse.current.bouge = true;
    const largeur = 56;
    const x = Math.min(Math.max(point.clientX - glisse.current.decalX, 4), window.innerWidth - largeur - 4);
    const y = Math.min(Math.max(point.clientY - glisse.current.decalY, 4), window.innerHeight - largeur - 4);
    setPos({ x, y });
  }
  function finGlisse(e) {
    // Filet de sécurité : recalcule aussi la distance au relâchement, au cas où
    // aucun mousemove n'aurait eu le temps de se déclencher pendant un geste rapide
    const point = e.changedTouches ? e.changedTouches[0] : e;
    if (typeof point?.clientX === "number") {
      const distance = Math.hypot(point.clientX - glisse.current.depart.x, point.clientY - glisse.current.depart.y);
      if (distance > 5) glisse.current.bouge = true;
    }
    glisse.current.actif = false;
    window.removeEventListener("mousemove", surGlisse);
    window.removeEventListener("mouseup", finGlisse);
    window.removeEventListener("touchmove", surGlisse);
    window.removeEventListener("touchend", finGlisse);
  }

  if (!visible) return null;
  const lien = `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;
  const styleParPosition = pos
    ? { left: pos.x, top: pos.y }
    : { bottom: 20, right: 20 };

  return (
    <div style={{ position: "fixed", zIndex: 999, ...styleParPosition }}>
      <a href={lien} target="_blank" rel="noopener noreferrer" aria-label="Contacter sur WhatsApp"
        onMouseDown={demarrerGlisse} onTouchStart={demarrerGlisse}
        onClick={e => { if (glisse.current.bouge) e.preventDefault(); }}
        style={{
          width: 56, height: 56, borderRadius: "50%", cursor: "grab",
          background: "#25D366", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 14px rgba(0,0,0,.25)", textDecoration: "none",
          transition: "transform .15s", userSelect: "none", touchAction: "none",
        }}>
        <svg viewBox="0 0 32 32" width="30" height="30" fill="#fff" aria-hidden="true">
          <path d="M16.004 3C9.06 3 3.4 8.65 3.4 15.6c0 2.42.66 4.68 1.8 6.63L3 29l7-1.83a12.5 12.5 0 0 0 6 1.53h.005c6.943 0 12.6-5.65 12.6-12.6C28.605 8.65 22.947 3 16.004 3zm0 22.9h-.004a10.4 10.4 0 0 1-5.3-1.45l-.38-.226-3.93 1.03 1.05-3.83-.25-.394a10.28 10.28 0 0 1-1.58-5.43c0-5.72 4.66-10.38 10.4-10.38 2.78 0 5.39 1.08 7.35 3.05a10.32 10.32 0 0 1 3.04 7.35c0 5.72-4.66 10.38-10.4 10.38zm5.7-7.78c-.31-.156-1.84-.91-2.13-1.014-.286-.104-.494-.156-.702.156-.208.31-.806 1.013-.988 1.222-.182.208-.364.234-.676.078-.31-.156-1.312-.484-2.5-1.55-.924-.826-1.548-1.846-1.73-2.156-.182-.31-.02-.478.137-.632.14-.14.31-.364.468-.546.156-.182.208-.312.312-.52.104-.208.052-.39-.026-.546-.078-.156-.702-1.694-.964-2.318-.254-.61-.512-.526-.702-.536l-.598-.01c-.208 0-.546.078-.832.39-.286.31-1.09 1.066-1.09 2.6s1.116 3.016 1.272 3.226c.156.208 2.196 3.354 5.322 4.702.744.322 1.324.514 1.776.658.746.238 1.424.204 1.96.124.598-.09 1.84-.752 2.1-1.478.26-.728.26-1.352.182-1.478-.078-.128-.286-.208-.598-.364z"/>
        </svg>
      </a>
      <button onClick={() => setVisible(false)} aria-label="Masquer le bouton WhatsApp"
        style={{
          position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%",
          background: "#fff", border: "1.5px solid #ddd", color: "#888", fontSize: 13, fontWeight: 700,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0, boxShadow: "0 1px 4px rgba(0,0,0,.2)", lineHeight: 1,
        }}>
        ✕
      </button>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState("accueil"); // accueil | locataire | proprio | auth | compte
  // Persiste la page affichée pour la retrouver après un F5 (uniquement les
  // pages "sûres" à restaurer sans données transitoires — pas le tunnel de
  // réservation ni l'état des lieux, qui repartent proprement de l'accueil).
  // On ignore le tout premier rendu (mode="accueil" par défaut, avant même
  // que la vérification de session ait pu lire et restaurer la valeur
  // sauvegardée) pour ne pas l'effacer prématurément.
  const premierRenduMode = useRef(true);
  useEffect(() => {
    if (premierRenduMode.current) { premierRenduMode.current = false; return; }
    if (mode === "compte" || mode === "proprio") sessionStorage.setItem('sp_mode', mode);
    else sessionStorage.removeItem('sp_mode');
  }, [mode]);
  const [consentementCookies, setConsentementCookies] = useState(null); // null = pas encore répondu | true | false
  const [modeOrigineAvantLegal, setModeOrigineAvantLegal] = useState("accueil"); // pour revenir après consultation des pages légales
  const [confirmationSuppression, setConfirmationSuppression] = useState(false);
  const [factureOuverte, setFactureOuverte] = useState(null);
  // Annulation par le locataire
  const [annulLocRef, setAnnulLocRef] = useState(null);
  const [annulLocMotif, setAnnulLocMotif] = useState("");
  const [annulLocConfirm, setAnnulLocConfirm] = useState(false);
  // Remboursement commercial proprio (après location)
  const [rembRef, setRembRef] = useState(null);
  const [rembMontant, setRembMontant] = useState("");
  // Affichage mot de passe (œil)
  const [showMdp, setShowMdp] = useState({ mdp: false, mdp2: false, login: false, loginInline: false, reset1: false, reset2: false, admin: false, proprio: false });
  const [chargementInitial, setChargementInitial] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(false);
  const [photoAffichee, setPhotoAffichee] = useState(0);
  const [galerieOuverte, setGalerieOuverte] = useState(false);
  const [photoPleinEcran, setPhotoPleinEcran] = useState(null); // index de la photo affichée en grand, null = fermé
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

  // ── Blocage après tentatives échouées ──
  const [tentativesAdmin, setTentativesAdmin] = useState(0);
  const [tentativesProprio, setTentativesProprio] = useState(0);
  const [tentativesLocataire, setTentativesLocataire] = useState(0);
  const [bloqueJusquA, setBloqueJusquA] = useState({ admin: null, proprio: null, locataire: null });

  // ── Réinitialisation mot de passe ──
  const [resetMode, setResetMode] = useState(null); // null | "admin" | "proprio" | "locataire"
  const [resetEmail, setResetEmail] = useState("");
  const [resetOtpEnvoye, setResetOtpEnvoye] = useState(false);
  const [resetOtpCode, setResetOtpCode] = useState("");
  const [resetOtpSaisi, setResetOtpSaisi] = useState("");
  const [resetOtpExp, setResetOtpExp] = useState(null);
  const [resetNouveauMdp, setResetNouveauMdp] = useState("");
  const [resetNouveauMdp2, setResetNouveauMdp2] = useState("");
  const [voirResetMdp, setVoirResetMdp] = useState(false); // afficher/masquer le mot de passe en clair
  const [resetErreur, setResetErreur] = useState("");
  const [resetEtape, setResetEtape] = useState(1); // 1=email, 2=code, 3=nouveau mdp, 4=succès
  // Mots de passe modifiables en runtime (initialisés depuis les constantes)
  // mdpAdmin/mdpProprio supprimés : les mots de passe vivent désormais uniquement
  // côté serveur (variables d'environnement Vercel), jamais en state React.

  // ── Annonce ──
  const [annonce, setAnnonce] = useState(ANNONCE_DEFAUT);

  // ── Base de données simulée ──
  // Disponibilités initialisées : 7h→00h00 par défaut pour les 90 prochains jours
  const dispoDerniereSauvegarde = useRef(null); // dernier état confirmé enregistré en base
  const [dispoStatut, setDispoStatut] = useState(null); // null / "encours" / "ok" / "erreur"
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
  // Réinitialisation des données de test (admin)
  const [confirmSuppression, setConfirmSuppression] = useState("");
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [suppressionResultat, setSuppressionResultat] = useState(null); // "ok" | "erreur" | null
  // Bannière de retour après paiement Stripe (lien envoyé à l'acceptation)
  const [retourPaiement, setRetourPaiement] = useState(null); // { type: "paiement", ref }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("paiement") === "succes") {
      setRetourPaiement({ type: "paiement", ref: params.get("ref") || "" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  // Extras configurables
  const [extras, setExtras] = useState(EXTRAS_DEFAUT);
  const [banqueImages, setBanqueImages] = useState([]);
  const [nouvelleImageBanque, setNouvelleImageBanque] = useState(null); // { url, nom } en attente de confirmation
  const [choixImageExtraId, setChoixImageExtraId] = useState(null); // id de l'extra en cours de sélection d'image (mode ajout ou édition)
  const [choixEmojiExtraId, setChoixEmojiExtraId] = useState(null); // id de l'extra en cours de sélection d'emoji

  // ── Chargement initial depuis Supabase ──
  useEffect(() => {
    let annule = false;
    async function chargerTout() {
      try {
        const [
          annonceData, dispoData, resaData, comptesData,
          inventaireData, elementsData, extrasData, codesData, notesData, configData, banqueImagesData
        ] = await Promise.all([
          chargerAnnonce(), chargerDisponibilites(), chargerReservations(), chargerComptes(),
          chargerInventaire(), chargerElementsEdl(), chargerExtras(), chargerCodesPromo(),
          chargerNotesLocataires(), chargerConfig(), chargerBanqueImages(),
        ]);
        if (annule) return;

        setBanqueImages(banqueImagesData || []);

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

        if (extrasData) {
          // Complète l'affichage avec les extras par défaut et Swimmy manquants
          // pour TOUS les visiteurs (aucune écriture en base ici — ce chargement
          // initial tourne pour n'importe quel client anonyme, pas seulement la
          // propriétaire). L'écriture réelle, si besoin, est gérée plus bas par
          // l'effet de sauvegarde, qui vérifie lui la session propriétaire/admin.
          const manquantsDefaut = EXTRAS_DEFAUT.filter(def => !extrasData.some(e => e.id === def.id));
          const manquantsSwimmy = EXTRAS_SWIMMY.filter(sw => !extrasData.some(e => e.id === sw.id) && !manquantsDefaut.some(d => d.id === sw.id));
          setExtras([...extrasData, ...manquantsDefaut, ...manquantsSwimmy]);
        } else {
          setExtras([...EXTRAS_DEFAUT, ...EXTRAS_SWIMMY]);
        }

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
      // Restaure la connexion admin/proprio/locataire si une session valide existe déjà
      // (cookie httpOnly posé lors d'une connexion précédente, encore valable)
      try {
        const repSession = await fetch('/api/auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ action: 'verifier-session' }),
        });
        if (repSession.ok && !annule) {
          const s = await repSession.json();
          const modeSauve = sessionStorage.getItem('sp_mode');
          const ongletSauve = sessionStorage.getItem('sp_onglet_proprio');
          if (s.role === 'admin') {
            setAdminConnecte(true);
            if (modeSauve === 'proprio') { setMode('proprio'); if (ongletSauve) setOngletPropri(ongletSauve); }
          } else if (s.role === 'proprio') {
            setProprioConnecte(true);
            if (modeSauve === 'proprio') { setMode('proprio'); if (ongletSauve) setOngletPropri(ongletSauve); }
          } else if (s.role === 'locataire' && s.email) {
            setComptes(prev => ({ ...prev, [s.email]: s.compte }));
            setCompteConnecte(s.email);
            setForm(f => ({ ...f, prenom: s.compte.prenom || "", nom: s.compte.nom || "", email: s.email, telephone: s.compte.telephone || "" }));
            if (modeSauve === 'compte') setMode('compte');
          }
        }
      } catch (e) { console.error('Erreur vérification session:', e); }
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

  // Navigation au clavier dans la visionneuse : flèches pour changer de photo,
  // Échap pour fermer. Indispensable pour l'accessibilité et confortable sur ordinateur.
  useEffect(() => {
    if (photoPleinEcran === null && !galerieOuverte) return;
    function auClavier(e) {
      if (e.key === "Escape") {
        if (photoPleinEcran !== null) setPhotoPleinEcran(null);
        else setGalerieOuverte(false);
        return;
      }
      if (photoPleinEcran === null) return;
      const total = annonce.photos.length;
      if (!total) return;
      if (e.key === "ArrowRight") setPhotoPleinEcran(i => (i + 1) % total);
      if (e.key === "ArrowLeft") setPhotoPleinEcran(i => (i - 1 + total) % total);
    }
    window.addEventListener("keydown", auClavier);
    return () => window.removeEventListener("keydown", auClavier);
  }, [photoPleinEcran, galerieOuverte, annonce.photos.length]);

  // ── Sauvegarde automatique vers Supabase à chaque changement (après le chargement initial) ──
  // On compare avec le dernier état confirmé enregistré pour n'écrire que les
  // dates réellement modifiées : c'est immédiat, et si l'écriture échoue on le
  // signale au lieu de laisser croire que c'est enregistré.
  useEffect(() => {
    if (chargementInitial) return;
    if (dispoDerniereSauvegarde.current === null) { dispoDerniereSauvegarde.current = disponibilites; return; }
    const precedent = dispoDerniereSauvegarde.current;
    if (precedent === disponibilites) return;
    if (!proprioConnecte && !adminConnecte) { dispoDerniereSauvegarde.current = disponibilites; return; }

    const memePlages = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
    const datesModifiees = Object.keys(disponibilites).filter(d => !memePlages(disponibilites[d], precedent[d]));
    const datesSupprimees = Object.keys(precedent).filter(d => !(d in disponibilites));
    if (!datesModifiees.length && !datesSupprimees.length) { dispoDerniereSauvegarde.current = disponibilites; return; }

    setDispoStatut("encours");
    sauvegarderDisponibilitesPartiel(datesModifiees.map(d => [d, disponibilites[d]]), datesSupprimees)
      .then(({ ok, error }) => {
        if (ok) {
          // Référence mise à jour uniquement en cas de succès : un échec sera réessayé
          dispoDerniereSauvegarde.current = disponibilites;
          setDispoStatut("ok");
        } else {
          setDispoStatut("erreur");
          alert(`⚠️ Tes créneaux n'ont PAS été enregistrés : ${error || "cause inconnue"}.\n\nReconnecte-toi (Se déconnecter puis reconnexion) et refais la modification.`);
        }
      });
  }, [disponibilites, chargementInitial, proprioConnecte, adminConnecte]);

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
    if (!proprioConnecte && !adminConnecte) return; // un visiteur anonyme ne peut/doit jamais tenter cette écriture
    sauvegarderExtras(extras).then(({ ok, error }) => {
      if (!ok) alert(`⚠️ Erreur lors de l'enregistrement des extras : ${error || "cause inconnue"}. Reconnecte-toi si besoin (Se déconnecter, puis reconnexion).`);
    });
  }, [extras, chargementInitial, proprioConnecte, adminConnecte]);

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
  const [form, setForm] = useState({ prenom: "", nom: "", email: "", telephone: "", adresse: "", codePostal: "", ville: "", date: "", creneaux: [], adultes: 1, enfants12: 0, moins3: 0, formuleGroupe: null, reglementAccepte: false });
  // Création de compte inline pendant la réservation
  const [formMdp, setFormMdp] = useState({ motdepasse: "", motdepasse2: "" });
  const [emailExistant, setEmailExistant] = useState(false); // true si l'email est déjà un compte
  const [loginInlineMode, setLoginInlineMode] = useState(false); // true = on propose de se connecter
  const [loginInlineMdp, setLoginInlineMdp] = useState("");
  const [loginInlineErreur, setLoginInlineErreur] = useState("");
  const [extrasChoisis, setExtrasChoisis] = useState({}); // { id: true/false }
  const [modePaiement, setModePaiement] = useState(null); // "cb" | "especes" 
  const [photosAvant, setPhotosAvant] = useState([]);
  const [photosApres, setPhotosApres] = useState([]);
  // ── Checklist état des lieux (coches Présent/Fonctionnel + commentaire + signature) ──
  const [edlReponses, setEdlReponses] = useState({});             // entrée : { item: { present, fonctionnel } }
  const [edlCommentaire, setEdlCommentaire] = useState("");
  const [edlSignature, setEdlSignature] = useState(null);         // dataURL de la signature
  const [edlReponsesSortie, setEdlReponsesSortie] = useState({});
  const [edlCommentaireSortie, setEdlCommentaireSortie] = useState("");
  const [edlSignatureSortie, setEdlSignatureSortie] = useState(null);
  const [photosCasse, setPhotosCasse] = useState([]);
  const [signalementCasse, setSignalementCasse] = useState(false);
  const [descriptionCasse, setDescriptionCasse] = useState("");
  const [reservation, setReservation] = useState(null);
  const [erreurs, setErreurs] = useState({});

  // ── Vérification téléphone OTP ──
  const [otpEnvoye, setOtpEnvoye] = useState(false);
  // Canal réellement utilisé pour le code : "sms" (vérifie aussi le numéro)
  // ou "email" (recours quand le SMS n'arrive pas)
  const [otpCanal, setOtpCanal] = useState("sms");
  const [otpCode, setOtpCode] = useState("");
  const [otpSaisi, setOtpSaisi] = useState("");
  const [otpErreur, setOtpErreur] = useState("");
  const [otpVerifie, setOtpVerifie] = useState(false);
  const [otpEnCours, setOtpEnCours] = useState(false);
  const [otpExpiration, setOtpExpiration] = useState(null);

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
  // Filtre de l'onglet Réservations : attente / avenir / passees / autres
  const [filtreResas, setFiltreResas] = useState("attente");
  // Même filtre côté locataire, dans son espace « Mes réservations »
  const [filtreMesResas, setFiltreMesResas] = useState("avenir");
  // Persiste l'onglet propriétaire actif pour le retrouver après un F5 (même
  // logique que pour "mode" : on ignore le tout premier rendu pour laisser le
  // temps à la restauration de session de lire la valeur sauvegardée)
  const premierRenduOnglet = useRef(true);
  useEffect(() => {
    if (premierRenduOnglet.current) { premierRenduOnglet.current = false; return; }
    sessionStorage.setItem('sp_onglet_proprio', ongletPropri);
  }, [ongletPropri]);
  const [noteEnCoursRef, setNoteEnCoursRef] = useState(null);
  const [refusEnCoursRef, setRefusEnCoursRef] = useState(null);
  const [annulEnCoursRef, setAnnulEnCoursRef] = useState(null);
  const [motifAnnulVal, setMotifAnnulVal] = useState("");
  const [annulationParLocataireVal, setAnnulationParLocataireVal] = useState(false);
  const [motifRefusVal, setMotifRefusVal] = useState("");
  const [nouvelExtra, setNouvelExtra] = useState({ nom:"", description:"", tarif:0, type:"forfait", emoji:"✨", image:null, actif:true });
  const [ajoutExtraMode, setAjoutExtraMode] = useState(false);
  const [extraEnEdition, setExtraEnEdition] = useState(null);
  const [periodeDebut, setPeriodeDebut] = useState("");
  const [periodeFin, setPeriodeFin] = useState("");
  const [noteProprioVal, setNoteProprioVal] = useState(0);
  const [commentaireProprioVal, setCommentaireProprioVal] = useState("");

  // ── Helpers blocage ──
  function estBloque(type) {
    const b = bloqueJusquA[type];
    if (!b) return false;
    if (Date.now() < b) return true;
    setBloqueJusquA(prev => ({ ...prev, [type]: null }));
    if (type === "admin") setTentativesAdmin(0);
    if (type === "proprio") setTentativesProprio(0);
    if (type === "locataire") setTentativesLocataire(0);
    return false;
  }
  function tempsRestant(type) {
    const b = bloqueJusquA[type];
    if (!b) return 0;
    return Math.max(0, Math.ceil((b - Date.now()) / 60000));
  }

  // ── Fonctions admin ──
  async function connecterAdmin() {
    if (estBloque("admin")) return;
    try {
      const rep = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action: 'connexion-admin', email: authAdmin.email, motdepasse: authAdmin.password }),
      });
      if (rep.ok) {
        setAdminConnecte(true);
        setErreurAdmin("");
        setTentativesAdmin(0);
        setMode("proprio");
        return;
      }
      // Le serveur fait foi (anti-bruteforce persisté) : on affiche son message tel quel
      const d = await rep.json().catch(() => ({}));
      setErreurAdmin(d.error || "Email ou mot de passe incorrect.");
      if (rep.status === 429) setBloqueJusquA(prev => ({ ...prev, admin: Date.now() + 30 * 60 * 1000 }));
      return;
    } catch (e) {
      console.error('Erreur connexion admin:', e);
      setErreurAdmin("Erreur réseau. Réessayez.");
    }
  }

  async function deconnecterAdmin() {
    try {
      await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'deconnexion', roles: ['admin'] }) });
    } catch (e) { console.error('Erreur déconnexion admin:', e); }
    setAdminConnecte(false);
    setOngletPropri("dispo"); // évite qu'un onglet admin-only reste affiché après la déconnexion
    setMode("accueil");
  }

  async function connecterProprio() {
    if (estBloque("proprio")) return;
    try {
      const rep = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action: 'connexion-proprio', email: authProprio.email, motdepasse: authProprio.password }),
      });
      if (rep.ok) {
        setProprioConnecte(true);
        setErreurProprio("");
        setTentativesProprio(0);
        setMode("proprio");
        return;
      }
      const d = await rep.json().catch(() => ({}));
      setErreurProprio(d.error || "Email ou mot de passe incorrect.");
      if (rep.status === 429) setBloqueJusquA(prev => ({ ...prev, proprio: Date.now() + 30 * 60 * 1000 }));
      return;
    } catch (e) {
      console.error('Erreur connexion proprio:', e);
      setErreurProprio("Erreur réseau. Réessayez.");
    }
  }

  async function deconnecterProprio() {
    try {
      await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'deconnexion', roles: ['proprio'] }) });
    } catch (e) { console.error('Erreur déconnexion proprio:', e); }
    setProprioConnecte(false);
    setMode("accueil");
  }

  // ── Réinitialisation mot de passe ──
  function ouvrirReset(type) {
    setResetMode(type);
    setResetEmail(type === "admin" ? ADMIN_EMAIL : type === "proprio" ? PROPRIO_EMAIL : "");
    setResetOtpEnvoye(false);
    setResetOtpCode("");
    setResetOtpSaisi("");
    setResetNouveauMdp("");
    setResetNouveauMdp2("");
    setResetErreur("");
    setResetEtape(1);
    setMode("resetMdp");
  }

  async function envoyerResetOTP() {
    const email = resetEmail.trim();
    if (!email) { setResetErreur("Veuillez saisir votre email."); return; }
    // Vérifier que l'email correspond au bon compte
    if (resetMode === "admin" && email !== ADMIN_EMAIL) { setResetErreur("Email inconnu pour ce compte."); return; }
    if (resetMode === "proprio" && email !== PROPRIO_EMAIL) { setResetErreur("Email inconnu pour ce compte."); return; }
    if (resetMode === "locataire" && !comptes[email]) { setResetErreur("Aucun compte locataire trouvé avec cet email."); return; }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const exp = Date.now() + 15 * 60 * 1000; // 15 min
    setResetOtpCode(code);
    setResetOtpExp(exp);
    setResetErreur("");
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#f8f9fa;padding:24px;">
      <div style="text-align:center;margin-bottom:20px;"><div style="font-size:32px;">🏊</div><div style="font-size:20px;font-weight:700;color:#07a0f2;">My Piscine Privée</div></div>
      <div style="background:#fff;border-radius:12px;padding:24px;">
        <h2 style="color:#07a0f2;margin-top:0;">🔐 Réinitialisation de mot de passe</h2>
        <p style="color:#2C3E50;font-size:14px;">Voici votre code de vérification pour réinitialiser votre mot de passe :</p>
        <div style="text-align:center;font-size:42px;font-weight:900;letter-spacing:10px;color:#07a0f2;margin:24px 0;font-family:monospace;">${code}</div>
        <p style="color:#888;font-size:12px;text-align:center;">Ce code est valable 15 minutes. Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
      </div></div>`;
    try {
      await fetch('/api/envoyer-email', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ destinataire: email, sujet: `🔐 Code de réinitialisation : ${code}`, html }) });
      setResetOtpEnvoye(true);
      setResetEtape(2);
    } catch(e) {
      setResetErreur("Erreur lors de l'envoi. Vérifiez votre connexion.");
    }
  }

  function validerResetOTP() {
    if (Date.now() > resetOtpExp) { setResetErreur("Code expiré. Cliquez sur « Renvoyer »."); setResetEtape(1); return; }
    if (resetOtpSaisi.trim() === resetOtpCode) { setResetErreur(""); setResetEtape(3); }
    else { setResetErreur("Code incorrect. Réessayez."); }
  }

  async function validerNouveauMdp() {
    if (resetMode === "admin" || resetMode === "proprio") {
      // Les mots de passe admin/propriétaire ne vivent plus que dans les variables
      // d'environnement Vercel (ADMIN_PASSWORD / PROPRIO_PASSWORD) — ils ne peuvent
      // plus être changés depuis l'app, pour éviter qu'ils soient de nouveau exposés
      // au navigateur. Il faut les modifier dans Vercel → Settings → Environment Variables.
      setResetErreur("");
      setResetEtape(4);
      return;
    }
    if (resetNouveauMdp.length < 8) { setResetErreur("Le mot de passe doit contenir au moins 8 caractères."); return; }
    if (resetNouveauMdp !== resetNouveauMdp2) { setResetErreur("Les deux mots de passe ne correspondent pas."); return; }
    try {
      const rep = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action: 'reinitialiser-mdp-locataire', email: resetEmail, nouveauMotdepasse: resetNouveauMdp }),
      });
      if (!rep.ok) {
        const d = await rep.json().catch(() => ({}));
        setResetErreur(d.error ? `Erreur : ${d.error}` : "Erreur lors de la réinitialisation. Réessayez.");
        return;
      }
    } catch (e) {
      console.error('Erreur réinitialisation mdp:', e);
      setResetErreur("Erreur réseau. Réessayez.");
      return;
    }
    // Débloquer le compte si bloqué
    setBloqueJusquA(prev => ({ ...prev, locataire: null }));
    setTentativesLocataire(0);
    setResetEtape(4);
    setResetErreur("");
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
      const minutes = maintenant.getMinutes();
      const dateAujourdhui = maintenant.toISOString().split("T")[0];

      reservations.forEach(r => {
        if (r.date !== dateAujourdhui) return;
        if (r.statut !== "acceptee") return;
        if (compteConnecte && r.email?.toLowerCase() !== compteConnecte.toLowerCase()) return;
        if (!compteConnecte && !adminConnecte && !proprioConnecte) return;

        // Conversion en Number pour éviter "9" === 9 → false (parseFloat pour gérer les demi-heures, ex. 14.5)
        const debut = parseFloat(r.heureDebut);
        const fin = parseFloat(r.heureFin);
        // Heure courante en décimal (ex. 14h30 → 14.5)
        const nowDec = heure + minutes / 60;

        // Alerte entrée : pendant toute la 1re heure du créneau
        const enSessionEntree = nowDec >= debut && nowDec < debut + 1;
        if (enSessionEntree && !r.edlEntreeFait) {
          setAlerteEdl("entree");
          setEdlResaRef(r.ref);
          setReservation(r);
        }

        // Alerte sortie : pendant l'heure qui suit la fin de session
        const enSessionSortie = nowDec >= fin && nowDec < fin + 1;
        if (enSessionSortie && r.edlEntreeFait && !r.edlSortieFait) {
          setAlerteEdl("sortie");
          setEdlResaRef(r.ref);
          setReservation(r);
        }

        // Rappel : si EDL entrée pas fait ET on est déjà dans la session (passé le début)
        if (nowDec > debut && nowDec < fin && !r.edlEntreeFait) {
          setAlerteEdl("entree");
          setEdlResaRef(r.ref);
          setReservation(r);
        }
      });
    };
    verifier();
    const interval = setInterval(verifier, 60000);
    return () => clearInterval(interval);
  }, [reservations, compteConnecte, adminConnecte, proprioConnecte]);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }
  const nbSlots = form.creneaux.length; // nombre de créneaux de 30 min
  const duree = nbSlots * PAS; // durée en heures
  const heureDebut = nbSlots > 0 ? Math.min(...form.creneaux) : null;
  const heureFin = nbSlots > 0 ? Math.max(...form.creneaux) + PAS : null;
  const prix = form.formuleGroupe && FORMULES_GROUPE[form.formuleGroupe]
    ? FORMULES_GROUPE[form.formuleGroupe].prix
    : prixTotal(form.adultes, form.enfants12, form.creneaux);
  // Remise automatique : 5% par tranche de 40€ complète sur le prix de la session
  // (avant extras), cumulable avec un éventuel code promo. Ex : 95€ → 2 tranches → 10%.
  // Plafonnée à 40% pour ne pas éroder la marge sur les très grosses réservations.
  // Remise fidélité automatique : 5% dès 50€ de session (avant extras), puis
  // +5% par tranche de 50€ supplémentaire. Plafonnée à 40%. Ex : 65€ → 5%,
  // 100€ → 10%, 150€ → 15%... Non applicable aux tarifs de groupe spéciaux
  // (voir formuleGroupe plus bas), qui ont leur propre règle de remise.
  const remiseTranches = form.formuleGroupe ? 0 : Math.min(Math.floor(prix / 50) * 5, 40);
  const remiseTotalePct = remise + remiseTranches;
  const prixFinal = remiseTotalePct > 0 ? +(prix * (1 - remiseTotalePct / 100)).toFixed(2) : prix;

  // Calcul extras — l'extra "Zéro vis-à-vis" est offert dès 30€ de session (avant extras)
  const zeroVisAVisOffert = prix >= 30;
  const totalExtras = extras.filter(e => e.actif && extrasChoisis[e.id] > 0).reduce((sum, e) => {
    const qte = extrasChoisis[e.id] || 0;
    const nb = e.type === "personne" ? qte : 1;
    const gratuit = e.id === "e1" && zeroVisAVisOffert;
    return sum + (gratuit ? 0 : e.tarif * nb);
  }, 0);
  const montantZeroVisAVisOffert = (zeroVisAVisOffert && extrasChoisis["e1"] > 0)
    ? (extras.find(e => e.id === "e1")?.tarif || 0)
    : 0;
  const totalGeneral = +(prixFinal + totalExtras).toFixed(2);
  const acompte = modePaiement === "especes" ? +(totalGeneral * 0.20).toFixed(2) : totalGeneral;
  const resteARegler = modePaiement === "especes" ? +(totalGeneral * 0.80).toFixed(2) : 0;

  // ── Auth functions ──
  async function inscrire() {
    const { prenom, nom, email, telephone, motdepasse, motdepasse2, cguAcceptees } = authForm;
    const emailNorm = email.trim().toLowerCase();
    if (!prenom || !nom || !emailNorm.includes("@") || !telephone || !motdepasse) { setAuthErreur("Tous les champs sont requis."); return; }
    if (motdepasse !== motdepasse2) { setAuthErreur("Les mots de passe ne correspondent pas."); return; }
    if (!cguAcceptees) { setAuthErreur("Vous devez accepter les CGU et la politique de confidentialité."); return; }
    if (comptes[emailNorm]) { setAuthErreur("Un compte existe déjà avec cet email."); return; }
    const { adresse, codePostal, ville } = authForm;
    if (!adresse || !codePostal || !ville) { setAuthErreur("Veuillez renseigner votre adresse complète."); return; }
    try {
      const rep = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action: 'creer-compte', prenom, nom, email: emailNorm, telephone, adresse, codePostal, ville, motdepasse }),
      });
      const d = await rep.json().catch(() => ({}));
      if (!rep.ok) { setAuthErreur(d.error || "Erreur lors de la création du compte."); return; }
      setComptes(prev => ({ ...prev, [emailNorm]: d.compte }));
      setCompteConnecte(emailNorm);
      setForm(f => ({ ...f, prenom, nom, email: emailNorm, telephone }));
      setAuthErreur("");
      setMode("accueil"); // → écran d'accueil personnalisé
    } catch (e) {
      console.error('Erreur inscription:', e);
      setAuthErreur("Erreur réseau. Réessayez.");
    }
  }

  async function connecter() {
    if (estBloque("locataire")) return;
    const { email, motdepasse } = authForm;
    const emailNorm = email.trim().toLowerCase();
    try {
      const rep = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ action: 'connexion-locataire', email: emailNorm, motdepasse }),
      });
      if (rep.ok) {
        const d = await rep.json();
        setComptes(prev => ({ ...prev, [emailNorm]: d.compte }));
        setCompteConnecte(emailNorm);
        setTentativesLocataire(0);
        setForm(f => ({ ...f, prenom: d.compte.prenom, nom: d.compte.nom, email: emailNorm, telephone: d.compte.telephone }));
        setAuthErreur("");
        setMode("accueil");
        return;
      }
      const d = await rep.json().catch(() => ({}));
      setAuthErreur(d.error || "Email ou mot de passe incorrect.");
      if (rep.status === 429) setBloqueJusquA(prev => ({ ...prev, locataire: Date.now() + 30 * 60 * 1000 }));
      return;
    } catch (e) {
      console.error('Erreur connexion locataire:', e);
      setAuthErreur("Erreur réseau. Réessayez.");
    }
  }

  async function deconnecter() {
    try {
      await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'deconnexion', roles: ['locataire'] }) });
    } catch (e) { console.error('Erreur déconnexion:', e); }
    setCompteConnecte(null); setMode("accueil");
  }

  // ── Calcul des pénalités d'annulation locataire ──
  function calculerPenalite(r) {
    const dateRes = new Date(`${r.date}T${heureToTime(r.heureDebut)}`);
    const maintenant = new Date();
    const diffH = (dateRes - maintenant) / 3600000; // différence en heures
    if (diffH <= 0) return { impossible: true, label: "La session a déjà commencé — annulation impossible." };
    if (diffH < 24) return { taux: 0.50, retenu: (r.totalGeneral||r.prix)*0.50, rembourse: (r.totalGeneral||r.prix)*0.50, label: "Annulation le jour même : 50% retenu" };
    if (diffH < 48) return { taux: 0.20, retenu: (r.totalGeneral||r.prix)*0.20, rembourse: (r.totalGeneral||r.prix)*0.80, label: "Annulation < 48h : 20% retenu" };
    return { taux: 0, retenu: 0, rembourse: r.totalGeneral||r.prix, label: "Annulation > 48h : remboursement intégral" };
  }

  async function annulerParLocataire(ref) {
    const r = reservations.find(x => x.ref === ref);
    if (!r) return;
    const penalite = calculerPenalite(r);
    if (penalite.impossible) return;
    let updated = { ...r, statut: "annulee", motifAnnulation: annulLocMotif || "Annulation à la demande du locataire", annulationParLocataire: true, penaliteTaux: penalite.taux, montantRetenu: penalite.retenu, montantRembourse: penalite.rembourse };
    setReservations(prev => prev.map(x => x.ref === ref ? updated : x));
    sauvegarderReservation(updated);
    // Remboursement automatique Stripe (montant net après pénalité éventuelle)
    if (r.paiement?.statut === "paye" && penalite.rembourse > 0) {
      try {
        const rep = await fetch('/api/paiement', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ action: 'rembourser', ref, montant: penalite.rembourse }),
        });
        if (rep.ok) {
          const d = await rep.json();
          updated = { ...updated, paiement: { ...updated.paiement, rembourse: true, montantRembourseStripe: d.montantRembourse } };
          setReservations(prev => prev.map(x => x.ref === ref ? updated : x));
        } else {
          console.error('Remboursement automatique échoué:', await rep.json().catch(() => ({})));
        }
      } catch (e) { console.error('Erreur réseau remboursement:', e); }
    }
    envoyerEmailAnnulation(updated);
    setAnnulLocRef(null); setAnnulLocMotif(""); setAnnulLocConfirm(false);
  }

  // ── Remboursement commercial (geste proprio après location) ──
  async function appliquerRemboursement(ref) {
    const montant = parseFloat(rembMontant);
    if (!montant || montant <= 0) return;
    const fraisGestion = montant * 0.25;
    const netRembourse = montant - fraisGestion;
    const r = reservations.find(x => x.ref === ref);
    if (!r) return;
    let updated = { ...r, remboursementCommercial: { montantDemande: montant, fraisGestion, netRembourse, date: new Date().toISOString() } };
    setReservations(prev => prev.map(x => x.ref === ref ? updated : x));
    sauvegarderReservation(updated);
    if (r.paiement?.statut === "paye") {
      try {
        const rep = await fetch('/api/paiement', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ action: 'rembourser', ref, montant: netRembourse }),
        });
        if (rep.ok) {
          const d = await rep.json();
          updated = { ...updated, paiement: { ...updated.paiement, rembourse: true, montantRembourseStripe: d.montantRembourse } };
          setReservations(prev => prev.map(x => x.ref === ref ? updated : x));
          // Prévenir le client par email et confirmer visuellement à la propriétaire
          envoyerEmailRemboursementCommercial(updated, montant, fraisGestion, netRembourse);
          alert(`✅ Remboursement Stripe effectué : ${netRembourse.toFixed(2).replace(".", ",")} € recrédités au client. Un email de confirmation lui a été envoyé.`);
        } else {
          const err = await rep.json().catch(() => ({}));
          console.error('Remboursement commercial échoué:', err);
          alert(`Le remboursement automatique a échoué (${err.error || "erreur inconnue"}). À faire manuellement depuis Stripe.`);
        }
      } catch (e) {
        console.error('Erreur réseau remboursement:', e);
        alert("Erreur réseau lors du remboursement. À faire manuellement depuis Stripe si besoin.");
      }
    } else {
      // Pas de paiement Stripe associé (ex : paiement espèces) — informer quand même le client
      envoyerEmailRemboursementCommercial(updated, montant, fraisGestion, netRembourse);
      alert(`✅ Remboursement enregistré (${netRembourse.toFixed(2).replace(".", ",")} €). Aucun paiement Stripe associé : à régler directement avec le client (espèces/virement). Un email l'en a informé.`);
    }
    setRembRef(null); setRembMontant("");
  }

  // Droit à l'effacement RGPD : suppression du compte locataire et de ses données
  async function supprimerMonCompte() {
    if (!compteConnecte) return;
    try {
      await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'supprimer-mon-compte' }) });
    } catch (e) { console.error('Erreur suppression compte:', e); }
    setComptes(prev => { const n = { ...prev }; delete n[compteConnecte]; return n; });
    setCompteConnecte(null);
    setConfirmationSuppression(false);
    setMode("accueil");
  }

  // ── Réservation functions ──
  async function validerEtape1() {
    const e = {};
    if (!form.prenom.trim()) e.prenom = "Requis";
    if (!form.nom.trim()) e.nom = "Requis";
    if (!form.email.includes("@")) e.email = "Email invalide";
    if (!form.telephone.trim()) e.telephone = "Requis";
    if (!form.date) e.date = "Sélectionnez une date";
    if (form.creneaux.length === 0) e.creneaux = "Sélectionnez au moins un créneau";
    else if (form.creneaux.length < MIN_SLOTS) e.creneaux = "La réservation doit durer au moins 1 heure";
    if (form.adultes < 1) e.adultes = "Minimum 1 adulte";
    if (form.formuleGroupe && FORMULES_GROUPE[form.formuleGroupe]) {
      const f = FORMULES_GROUPE[form.formuleGroupe];
      if (form.creneaux.length > 0 && form.creneaux.length !== f.dureeSlots) {
        e.formuleGroupe = "Cette formule nécessite une session de 3h pile.";
      } else if (form.formuleGroupe === "groupe10" && (form.adultes + form.enfants12) > f.maxPersonnes) {
        e.formuleGroupe = "10 personnes maximum (adultes + enfants) pour cette formule.";
      } else if (form.formuleGroupe === "groupe5" && (form.adultes > f.maxAdultes || form.enfants12 > 0)) {
        e.formuleGroupe = "5 adultes maximum et sans enfant pour cette formule.";
      }
    }

    // Si pas encore connecté, vérifier la partie compte
    if (!compteConnecte) {
      const emailTrim = form.email.trim().toLowerCase();
      const compteExistant = comptes[emailTrim];
      if (compteExistant && !loginInlineMode) {
        // Email connu mais pas en mode login : proposer la connexion
        setEmailExistant(true);
        setLoginInlineMode(true);
        setErreurs(e);
        return false;
      }
      if (loginInlineMode) {
        // Mode connexion avec compte existant : vérification côté serveur
        if (!loginInlineMdp) { e.mdp = "Mot de passe requis"; setErreurs(e); return false; }
        try {
          const rep = await fetch('/api/auth', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify({ action: 'connexion-locataire', email: emailTrim, motdepasse: loginInlineMdp }),
          });
          if (!rep.ok) { e.mdp = "Mot de passe incorrect"; setErreurs(e); return false; }
          const d = await rep.json();
          setComptes(prev => ({ ...prev, [emailTrim]: d.compte }));
          setCompteConnecte(emailTrim);
          setForm(f => ({ ...f, prenom: d.compte.prenom, nom: d.compte.nom, telephone: d.compte.telephone, adresse: d.compte.adresse || "", codePostal: d.compte.codePostal || "", ville: d.compte.ville || "" }));
          setLoginInlineMode(false); setEmailExistant(false); setLoginInlineMdp(""); setLoginInlineErreur("");
          return true;
        } catch (err) {
          console.error('Erreur login inline:', err);
          e.mdp = "Erreur réseau, réessayez";
          setErreurs(e);
          return false;
        }
      }
      // Nouveau compte : vérifier mdp
      if (!form.adresse?.trim()) e.adresse = "Requis";
      if (!form.codePostal?.trim()) e.codePostal = "Requis";
      if (!form.ville?.trim()) e.ville = "Requis";
      if (!formMdp.motdepasse || formMdp.motdepasse.length < 8) e.mdp = "8 caractères minimum";
      if (formMdp.motdepasse !== formMdp.motdepasse2) e.mdp2 = "Les mots de passe ne correspondent pas";
    }

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
    // Applique le taux propre à ce code (5% pour une note 4★, 10% pour 5★)
    setCodePromoStatut("ok"); setRemise(entree.taux || 5);
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
    // Compléter les réponses par défaut (tout présent/fonctionnel) pour les
    // éléments que le locataire n'a pas touchés — cocher est l'exception
    const reponsesCompletes = {};
    elementsEdl.forEach(item => { reponsesCompletes[item] = edlReponses[item] || { present: true, fonctionnel: true }; });
    const edlEntree = { reponses: reponsesCompletes, commentaire: edlCommentaire, signature: edlSignature, date: new Date().toISOString() };
    setReservations(prev => {
      const next = prev.map(r => r.ref === reservation?.ref ? { ...r, edlEntree, edlEntreeFait: true } : r);
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

  // ── Vérification téléphone par OTP ──
  // Convertit un numéro français saisi localement (ex: "06 12 34 56 78") au
  // format international E.164 attendu par Twilio (ex: "+33612345678")
  function normaliserTelephoneFR(tel) {
    const chiffres = (tel || "").replace(/\D/g, "");
    if (chiffres.startsWith("33") && chiffres.length === 11) return "+" + chiffres;
    if (chiffres.startsWith("0") && chiffres.length === 10) return "+33" + chiffres.slice(1);
    return "+" + chiffres; // repli : on suppose que l'indicatif est déjà inclus
  }

  // Envoi du code de vérification. Deux canaux possibles : SMS (par défaut, il
  // vérifie en prime que le numéro fourni est joignable) et email en recours,
  // pour ne jamais bloquer un client qui ne reçoit pas le SMS (pas de réseau,
  // numéro mal saisi, opérateur capricieux…).
  async function envoyerOTP(canal = "sms") {
    // Un code déjà en cours reste valable : on ne le régénère que si besoin,
    // ainsi un client qui bascule sur l'email peut aussi saisir le code du SMS
    // s'il finit par arriver.
    const code = otpCode || String(Math.floor(100000 + Math.random() * 900000));
    setOtpCode(code);
    setOtpExpiration(Date.now() + 10 * 60 * 1000); // 10 minutes
    setOtpErreur("");
    setOtpEnCours(true);
    setOtpCanal(canal);

    try {
      let rep;
      if (canal === "email") {
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #f8f9fa; padding: 24px;">
            <div style="text-align:center; margin-bottom:20px;">
              <div style="font-size:32px;">🏊</div>
              <div style="font-size:20px; font-weight:700; color:#07a0f2;">My Piscine Privée</div>
            </div>
            <div style="background:#fff; border-radius:14px; padding:24px;">
              <h2 style="color:#07a0f2; margin-top:0;">🔐 Votre code de vérification</h2>
              <p style="color:#2C3E50; font-size:14px;">Saisissez ce code dans l'application pour confirmer votre réservation :</p>
              <div style="text-align:center; font-size:40px; font-weight:900; letter-spacing:10px; color:#07a0f2; margin:24px 0; font-family:monospace;">${code}</div>
              <p style="color:#888; font-size:12px; text-align:center;">Ce code est valable 10 minutes.</p>
            </div>
          </div>`;
        rep = await fetch('/api/envoyer-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ destinataire: form.email, sujet: `🔐 Code de vérification : ${code}`, html }),
        });
      } else {
        rep = await fetch('/api/envoyer-sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destinataire: normaliserTelephoneFR(form.telephone),
            message: `🏊 My Piscine Privée : votre code de vérification est ${code} (valable 10 minutes).`,
          }),
        });
      }

      if (rep.ok) {
        setOtpEnvoye(true);
      } else {
        const d = await rep.json().catch(() => ({}));
        if (canal === "sms") {
          // Échec du SMS : on bascule tout de suite sur l'email plutôt que de
          // laisser le client devant un message d'erreur sans solution.
          setOtpEnCours(false);
          return envoyerOTP("email");
        }
        setOtpErreur(d.error || "Erreur lors de l'envoi du code. Vérifiez vos coordonnées.");
      }
    } catch (e) {
      if (canal === "sms") { setOtpEnCours(false); return envoyerOTP("email"); }
      setOtpErreur("Erreur lors de l'envoi. Vérifiez votre connexion.");
    }
    setOtpEnCours(false);
  }

  function validerOTP() {
    if (!otpCode) { setOtpErreur("Code non généré, renvoyez-le."); return; }
    if (Date.now() > otpExpiration) { setOtpErreur("Ce code a expiré. Demandez-en un nouveau."); setOtpEnvoye(false); return; }
    if (otpSaisi.trim() === otpCode) {
      setOtpVerifie(true);
      setOtpErreur("");
    } else {
      setOtpErreur(`Code incorrect. Vérifiez ${otpCanal === "email" ? "votre email" : "votre SMS"} et réessayez.`);
    }
  }

  async function confirmerReservation() {
    const ref = "RES-" + Date.now().toString(36).toUpperCase();
    const emailRes = form.email.trim().toLowerCase();
    // Créer le compte si c'est un nouveau locataire (non connecté) — hachage et
    // session gérés côté serveur, jamais de mot de passe en clair stocké ici
    let compteActif = compteConnecte;
    if (!compteActif && formMdp.motdepasse) {
      try {
        const rep = await fetch('/api/auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({
            action: 'creer-compte',
            prenom: form.prenom, nom: form.nom, email: emailRes, telephone: form.telephone,
            // Trace du canal de vérification : si le code est passé par email, le
            // numéro n'a PAS été confirmé joignable — utile à savoir côté propriétaire.
            verificationCanal: otpCanal,
            adresse: form.adresse || "", codePostal: form.codePostal || "", ville: form.ville || "",
            motdepasse: formMdp.motdepasse,
          }),
        });
        if (rep.ok) {
          const d = await rep.json();
          setComptes(prev => ({ ...prev, [emailRes]: d.compte }));
          setCompteConnecte(emailRes);
          compteActif = emailRes;
        } else {
          const d = await rep.json().catch(() => ({}));
          console.error('Création compte échouée:', d);
          setAuthErreur(d.error || "Impossible de créer le compte. Réessayez.");
          return;
        }
      } catch (e) {
        console.error('Erreur réseau création compte:', e);
        setAuthErreur("Erreur réseau. Réessayez.");
        return;
      }
    }
    const compteInfo = compteActif ? (comptes[compteActif] || {}) : {};
    const demandeISO = new Date().toISOString();
    // Aucune interaction Stripe à ce stade : le lien de paiement n'est envoyé
    // qu'après validation par le propriétaire (voir accepterReservation).
    // Le créneau n'est bloqué pour les autres visiteurs qu'une fois payé
    // (voir statutHeures/heuresBloquees) — plusieurs demandes concurrentes sur
    // le même créneau sont possibles, le premier à payer l'obtient.
    const r = { ...form, email: emailRes, heureDebut, heureFin, prix: prixFinal, prixBrut: prix, remise, remiseFidelite: remiseTranches, extrasChoisis, totalExtras, totalGeneral, modePaiement, acompte, resteARegler, ref, photosAvant: [], photosApres: [], adresse: form.adresse || compteInfo.adresse || "", codePostal: form.codePostal || compteInfo.codePostal || "", ville: form.ville || compteInfo.ville || "", statut: "en_attente", demandeISO, paiement: { statut: "non_paye" } };
    setReservations(prev => [...prev, r]);
    setReservation(r);
    await sauvegarderReservation(r);
    // L'état des lieux d'entrée et de sortie se font le jour J, depuis "Mon compte" ou via la bannière d'alerte
    envoyerEmailNouvelleDemande(r, PROPRIO_EMAIL);
    envoyerSmsNouvelleDemande(r);
    if (codePromoStatut === "ok" && codePromoSaisi) {
      const code = codePromoSaisi.trim().toUpperCase();
      setRegistreCodes(prev => {
        const next = { ...prev, [code]: { ...prev[code], utilise: true } };
        sauvegarderCodePromo(code, next[code]);
        return next;
      });
    }
    // Associer au compte locataire
    if (compteActif) {
      setComptes(prev => {
        const next = { ...prev, [compteActif]: { ...prev[compteActif], reservations: [...(prev[compteActif]?.reservations || []), ref] } };
        sauvegarderCompte(compteActif, next[compteActif]);
        return next;
      });
    }
    setStep(5);
  }

  async function accepterReservation(ref) {
    const current = reservations.find(r => r.ref === ref);
    if (!current) return;
    // Envoi systématique d'un lien de paiement — le créneau reste ouvert aux
    // autres visiteurs tant que ce paiement n'est pas confirmé (voir statutHeures)
    let paiement = current.paiement || null;
    try {
      const rep = await fetch('/api/paiement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'creer-lien-paiement', ref }),
      });
      if (rep.ok) {
        const d = await rep.json();
        paiement = { statut: "en_attente", url: d.url, montant: d.montant, lienId: d.lienId, creeLe: new Date().toISOString() };
      } else {
        console.error('Création lien paiement échouée:', await rep.json().catch(() => ({})));
      }
    } catch (e) {
      console.error('Erreur réseau création lien paiement:', e);
    }

    const updated = { ...current, statut: "acceptee", ...(paiement ? { paiement } : {}) };
    setReservations(prev => prev.map(r => r.ref === ref ? updated : r));
    sauvegarderReservation(updated);
    envoyerEmailAcceptation(updated);
    // SMS d'invitation à payer : le client reçoit le lien directement sur son
    // téléphone, cliquable, sans avoir à ouvrir sa boîte mail. C'est le moment
    // le plus sensible du parcours — le créneau n'est bloqué qu'une fois payé.
    if (paiement?.url) envoyerSmsInvitationPaiement(updated, paiement);
  }

  function refuserReservation(ref, motif) {
    setReservations(prev => {
      const next = prev.map(r => r.ref === ref ? { ...r, statut: "refusee", motifRefus: motif || "" } : r);
      const updated = next.find(r => r.ref === ref);
      if (updated) { sauvegarderReservation(updated); envoyerEmailRefus(updated); }
      return next;
    });
  }

  // Annulation d'une réservation déjà acceptée (initiative propriétaire ou demande locataire relayée)
  async function annulerReservation(ref, motif, origineLocataire) {
    const r = reservations.find(x => x.ref === ref);
    if (!r) return;
    let updated = { ...r, statut: "annulee", motifAnnulation: motif || "", annulationParLocataire: !!origineLocataire };
    setReservations(prev => prev.map(x => x.ref === ref ? updated : x));
    sauvegarderReservation(updated);
    // Remboursement automatique intégral si la réservation était déjà payée
    // (annulation à l'initiative du propriétaire = pas de pénalité pour le client)
    if (r.paiement?.statut === "paye") {
      try {
        const rep = await fetch('/api/paiement', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ action: 'rembourser', ref }), // pas de "montant" → remboursement intégral
        });
        if (rep.ok) {
          const d = await rep.json();
          updated = { ...updated, paiement: { ...updated.paiement, rembourse: true, montantRembourseStripe: d.montantRembourse } };
          setReservations(prev => prev.map(x => x.ref === ref ? updated : x));
        } else {
          console.error('Remboursement automatique échoué:', await rep.json().catch(() => ({})));
        }
      } catch (e) { console.error('Erreur réseau remboursement:', e); }
    }
    envoyerEmailAnnulation(updated);
  }

  function cloturerSession() {
    const reponsesCompletes = {};
    elementsEdl.forEach(item => { reponsesCompletes[item] = edlReponsesSortie[item] || { present: true, fonctionnel: true }; });
    const edlSortie = { reponses: reponsesCompletes, commentaire: edlCommentaireSortie, signature: edlSignatureSortie, date: new Date().toISOString() };
    setReservations(prev => {
      const next = prev.map(r => r.ref === reservation?.ref ? { ...r, edlSortie, photosCasse, descriptionCasse, edlSortieFait: true, edlValideProprio: false } : r);
      const updated = next.find(r => r.ref === reservation?.ref);
      if (updated) {
        sauvegarderReservation(updated);
        // Notifier la propriétaire : l'état des lieux de sortie attend sa validation
        envoyerEmailEdlAValider(updated, PROPRIO_EMAIL);
        envoyerSmsEdlAValider(updated);
      }
      return next;
    });
    if (reservation?.ref) marquerEdlSortie(reservation.ref);
    setMode("locataire"); setStep(7);
  }

  function soumettreAvis() {
    if (note === 0) return;
    // On enregistre l'avis du locataire — le code promo sera généré
    // uniquement quand le propriétaire note le locataire ≥ 4 étoiles
    setReservations(prev => {
      const next = prev.map(r => r.ref === reservation?.ref ? { ...r, note, commentaire } : r);
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

  // ── Réinitialisation des données de test (admin uniquement) ──
  // Supprime toutes les réservations, notes et codes promo → remet les stats à zéro.
  // Ne touche PAS : annonce, disponibilités, extras, inventaire, comptes locataires, config.
  async function reinitialiserDonneesTest() {
    if (confirmSuppression !== "SUPPRIMER") return;
    setSuppressionEnCours(true);
    setSuppressionResultat(null);
    const okRes = await supprimerToutesReservations();
    const okNotes = await supprimerToutesNotesLocataires();
    const okCodes = await supprimerTousCodesPromo();
    if (okRes && okNotes && okCodes) {
      setReservations([]);
      setNotesLocataires({});
      setRegistreCodes({});
      setSuppressionResultat("ok");
      setConfirmSuppression("");
    } else {
      setSuppressionResultat("erreur");
    }
    setSuppressionEnCours(false);
  }
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
    const noteData = { note: noteProprioVal, commentaire: commentaireProprioVal };
    setNotesLocataires(prev => ({ ...prev, [ref]: noteData }));
    sauvegarderNoteLocataire(ref, noteData);
    // Code promo selon la note : 4★ = -5%, 5★ = -10%, valable 1 mois
    if (noteProprioVal >= 4) {
      const taux = noteProprioVal === 5 ? 10 : 5;
      const promo = genererCodePromo();
      promo.taux = taux;
      const codeData = { expiration: promo.expiration, dateExpISO: promo.dateExpISO, taux, utilise: false, reservationRef: ref };
      setRegistreCodes(prev => ({ ...prev, [promo.code]: codeData }));
      sauvegarderCodePromo(promo.code, codeData);
      // Stocker le code dans la réservation pour que le locataire le voie,
      // et le lui envoyer aussi par email pour qu'il ne le rate pas
      setReservations(prev => {
        const next = prev.map(r => r.ref === ref ? { ...r, codePromo: promo } : r);
        const updated = next.find(r => r.ref === ref);
        if (updated) {
          sauvegarderReservation(updated);
          envoyerEmailCodePromo(updated, noteProprioVal, promo);
        }
        return next;
      });
    }
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
        // Fermer ce créneau de 30 min : découper les plages existantes
        nouvPlages = [];
        plages.forEach(p => {
          if (h >= p.fin || h < p.debut) { nouvPlages.push(p); }
          else {
            if (p.debut < h) nouvPlages.push({ debut: p.debut, fin: h });
            if (h + PAS < p.fin) nouvPlages.push({ debut: h + PAS, fin: p.fin });
          }
        });
      } else {
        // Ouvrir ce créneau de 30 min : ajouter et fusionner
        nouvPlages = [...plages, { debut: h, fin: h + PAS }]
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
    setOtpEnvoye(false); setOtpCode(""); setOtpSaisi(""); setOtpErreur(""); setOtpVerifie(false); setOtpEnCours(false); setOtpExpiration(null);
    setFormMdp({ motdepasse: "", motdepasse2: "" }); setEmailExistant(false); setLoginInlineMode(false); setLoginInlineMdp(""); setLoginInlineErreur("");
  }

  // ── HEADER ────────────────────────────────────────────────────────────────
  const STEP_LABELS = ["", "Calendrier & horaires", "Règlement", "Extras & paiement", "Paiement", "État arrivée", "Session en cours", "État départ"];
  function Header({ showSteps }) {
    return (
      <>
      <div style={{ background: "#07a0f2" }}>
        <div style={{ padding: "18px 16px 4px", textAlign: "center" }}>
          <div style={{ fontSize: 28 }}>🏊</div>
          <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 22, fontWeight: 900, color: "#fff", marginTop: 3 }}>My Piscine Privée</div>
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
          <div style={{ background: alerteEdl==="entree" ? "#39b8f5" : "#FF6B6B", padding:"10px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
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
              {[1, 2, 3, 4, 5].map(n => (<div key={n} style={{ display: "flex", alignItems: "center", gap: 3 }}><StepDot n={n} active={step === n} done={step > n} />{n < 5 && <div style={{ width: 12, height: 2, background: step > n ? "#39b8f5" : "rgba(255,255,255,.25)", borderRadius: 2 }} />}</div>))}
            </div>
            <div style={{ textAlign: "center", color: "#e0f4f8", fontSize: 11, paddingBottom: 5, paddingTop: 2 }}>{STEP_LABELS[Math.min(step, 7)]}</div>
          </>
        )}
        <Waves />
        {consentementCookies === null && !chargementInitial && (
          <div style={{ position:"fixed", left:0, right:0, bottom:0, zIndex:2000, background:"#fff", boxShadow:"0 -4px 20px rgba(0,0,0,.15)", padding:"16px", borderRadius:"16px 16px 0 0" }}>
            <div style={{ fontSize:13, color:"#2C3E50", lineHeight:1.6, marginBottom:12 }}>
              🍪 Cette application utilise uniquement des cookies techniques nécessaires à son fonctionnement (connexion, préférences de réservation). Aucun cookie publicitaire n'est utilisé.{" "}
              <span onClick={() => { setModeOrigineAvantLegal(mode); setMode("confidentialite"); }} style={{ color:"#07a0f2", fontWeight:700, cursor:"pointer", textDecoration:"underline" }}>En savoir plus</span>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => repondreConsentement(true)} style={{ flex:1, padding:"10px", borderRadius:9, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                Accepter
              </button>
              <button onClick={() => repondreConsentement(false)} style={{ flex:1, padding:"10px", borderRadius:9, background:"#fff", color:"#07a0f2", border:"1.5px solid #07a0f2", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                Refuser
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Bouton flottant WhatsApp — uniquement côté client, pas sur le tableau de bord propriétaire/admin */}
      {mode !== "proprio" && <BoutonWhatsApp />}
      {/* Cible du lien d'évitement « Aller au contenu principal » (voir index.html).
          Placée ici, elle existe sur toutes les pages puisque toutes affichent le Header.
          tabIndex -1 : non atteignable par Tabulation, mais peut recevoir le focus par ancre. */}
      <span id="contenu-principal" tabIndex={-1} />
      </>
    );
  }

  // ── ÉCRAN DE CHARGEMENT INITIAL ───────────────────────────────────────────
  if (chargementInitial) return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#f8f9fa", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:14, animation:"pulse 1.5s infinite" }}>🏊</div>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#07a0f2", fontWeight:700 }}>Chargement...</div>
        <style>{`@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }`}</style>
      </div>
    </div>
  );

  if (erreurChargement) return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#f8f9fa", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ textAlign:"center", maxWidth:340 }}>
        <div style={{ fontSize:48, marginBottom:14 }}>⚠️</div>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#FF6B6B", fontWeight:700, marginBottom:10 }}>Connexion impossible</div>
        <div style={{ fontSize:13, color:"#6b7f8c", lineHeight:1.6, marginBottom:16 }}>Impossible de charger les données. Vérifiez votre connexion internet et réessayez.</div>
        <button onClick={() => window.location.reload()} style={{ background:"#07a0f2", color:"#fff", border:"none", borderRadius:10, padding:"12px 24px", fontSize:14, fontWeight:700, cursor:"pointer" }}>Réessayer</button>
      </div>
    </div>
  );


  // ── PAGE ANNONCE PUBLIQUE ────────────────────────────────────────────────
  if (mode === "annonce") return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#f8f9fa", minHeight:"100vh" }}>
      <Header showSteps={false}/>
      <div style={{ padding:"0 0 32px" }}>
        {/* Galerie photos */}
        {annonce.photos.length > 0 ? (
          <div style={{ position:"relative", height:240, overflow:"hidden", background:"#07a0f2" }}>
            {/* Un clic sur la photo l'ouvre en grand, comme sur Swimmy */}
            <img src={annonce.photos[photoAffichee] || annonce.photos[0]} alt="Vue de la piscine"
              onClick={() => setPhotoPleinEcran(photoAffichee)}
              style={{ width:"100%", height:"100%", objectFit:"cover", opacity:.9, cursor:"zoom-in" }}/>
            {annonce.photos.length > 1 && (
              <>
                {/* Flèche gauche */}
                <button aria-label="Photo précédente" onClick={() => setPhotoAffichee(i => (i - 1 + annonce.photos.length) % annonce.photos.length)}
                  style={{ position:"absolute", left:8, top:"50%", transform:"translateY(-50%)", background:"rgba(0,0,0,.4)", color:"#fff", border:"none", borderRadius:"50%", width:36, height:36, fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
                {/* Flèche droite */}
                <button aria-label="Photo suivante" onClick={() => setPhotoAffichee(i => (i + 1) % annonce.photos.length)}
                  style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"rgba(0,0,0,.4)", color:"#fff", border:"none", borderRadius:"50%", width:36, height:36, fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
                {/* Points de pagination */}
                <div style={{ position:"absolute", bottom:12, left:0, right:0, display:"flex", justifyContent:"center", gap:6 }}>
                  {annonce.photos.map((_, i) => (
                    <div key={i} onClick={() => setPhotoAffichee(i)}
                      style={{ width:7, height:7, borderRadius:"50%", background: i===photoAffichee ? "#fff" : "rgba(255,255,255,.4)", cursor:"pointer" }}/>
                  ))}
                </div>
              </>
            )}
            {/* Bouton d'accès à la grille complète, façon « Voir les images » de Swimmy */}
            <button onClick={() => setGalerieOuverte(true)}
              style={{ position:"absolute", bottom:10, right:10, background:"rgba(255,255,255,.95)", color:"#2C3E50", border:"none", borderRadius:20, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer", boxShadow:"0 2px 8px rgba(0,0,0,.2)" }}>
              📷 Voir les {annonce.photos.length} photos
            </button>
          </div>
        ) : (
          <div style={{ height:180, background:"#07a0f2", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" }}>
            <div style={{ fontSize:48 }}>🏊</div>
            <div style={{ color:"rgba(255,255,255,.7)", fontSize:13, marginTop:4 }}>Photos à venir</div>
          </div>
        )}

        {/* Grille de toutes les photos — miniatures entières, jamais rognées */}
        {galerieOuverte && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.94)", zIndex:1000, display:"flex", flexDirection:"column", padding:"14px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, flexShrink:0 }}>
              <span style={{ color:"#fff", fontWeight:700, fontSize:15 }}>📷 {annonce.photos.length} photos</span>
              <button aria-label="Fermer la galerie" onClick={() => setGalerieOuverte(false)} style={{ background:"rgba(255,255,255,.15)", color:"#fff", border:"none", borderRadius:"50%", width:34, height:34, fontSize:18, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ flex:1, overflowY:"auto", display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10, alignContent:"start", paddingBottom:10 }}>
              {annonce.photos.map((url, i) => (
                <button key={i} onClick={() => setPhotoPleinEcran(i)} aria-label={`Agrandir la photo ${i+1}`}
                  style={{ padding:0, border:"none", background:"#141414", borderRadius:10, cursor:"zoom-in", overflow:"hidden", aspectRatio:"4 / 3" }}>
                  {/* objectFit contain : la photo entière reste visible dans la miniature */}
                  <img src={url} alt={`Photo ${i+1} de la piscine`} style={{ width:"100%", height:"100%", objectFit:"contain", display:"block" }}/>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Visionneuse plein écran : une seule photo, entière, avec navigation */}
        {photoPleinEcran !== null && annonce.photos[photoPleinEcran] && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.97)", zIndex:1100, display:"flex", flexDirection:"column" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 16px", flexShrink:0 }}>
              <span style={{ color:"#fff", fontSize:14, fontWeight:700 }}>{photoPleinEcran + 1} / {annonce.photos.length}</span>
              <button aria-label="Fermer la photo" onClick={() => setPhotoPleinEcran(null)}
                style={{ background:"rgba(255,255,255,.15)", color:"#fff", border:"none", borderRadius:"50%", width:38, height:38, fontSize:20, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", minHeight:0, padding:"0 8px 16px" }}>
              {annonce.photos.length > 1 && (
                <button aria-label="Photo précédente" onClick={() => setPhotoPleinEcran(i => (i - 1 + annonce.photos.length) % annonce.photos.length)}
                  style={{ position:"absolute", left:10, background:"rgba(255,255,255,.18)", color:"#fff", border:"none", borderRadius:"50%", width:44, height:44, fontSize:24, cursor:"pointer", zIndex:2 }}>‹</button>
              )}
              {/* objectFit contain : la photo est affichée en entier, jamais coupée */}
              <img src={annonce.photos[photoPleinEcran]} alt={`Photo ${photoPleinEcran+1} de la piscine en grand format`}
                style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", borderRadius:8 }}/>
              {annonce.photos.length > 1 && (
                <button aria-label="Photo suivante" onClick={() => setPhotoPleinEcran(i => (i + 1) % annonce.photos.length)}
                  style={{ position:"absolute", right:10, background:"rgba(255,255,255,.18)", color:"#fff", border:"none", borderRadius:"50%", width:44, height:44, fontSize:24, cursor:"pointer", zIndex:2 }}>›</button>
              )}
            </div>
          </div>
        )}


        <div style={{ padding:"16px 16px 0" }}>
          {/* Titre + statut */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, fontWeight:700, color:"#2C3E50", lineHeight:1.3, flex:1 }}>
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
          <div style={{ background:"#07a0f2", borderRadius:12, padding:"12px 16px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ color:"#b8e8f0", fontSize:12 }}>À partir de</div>
              <div style={{ color:"#fff", fontWeight:700, fontSize:22, fontFamily:"'Nunito',sans-serif" }}>{TARIF_BASE} €<span style={{ fontSize:13, fontWeight:400 }}>/pers/h</span></div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ color:"#ffe082", fontSize:12 }}>🌙 Soirée (après 20h)</div>
              <div style={{ color:"#fff", fontWeight:600, fontSize:14 }}>{TARIF_BASE+TARIF_SOIREE} €/pers/h</div>
            </div>
          </div>

          {/* Description */}
          <div style={{ ...card, marginBottom:14 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", fontWeight:700, marginBottom:10 }}>À propos</div>
            <div style={{ fontSize:13, color:"#2C3E50", lineHeight:1.8, whiteSpace:"pre-line" }}>{annonce.description}</div>
          </div>

          {/* Équipements */}
          <div style={{ ...card, marginBottom:14 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", fontWeight:700, marginBottom:12 }}>🧰 Équipements</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {Object.entries(annonce.equipements).filter(([,v])=>v).map(([k])=>{
                const [emoji,label] = EQUIPEMENTS_LABELS[k]||["✓",k];
                return (
                  <div key={k} style={{ display:"flex", alignItems:"center", gap:5, background:"#e8f6fe", borderRadius:20, padding:"5px 12px", fontSize:12, fontWeight:600, color:"#07a0f2" }}>
                    {emoji} {label}
                  </div>
                );
              })}
              {/* Équipements personnalisés (ex : parking) visibles au même titre que les autres */}
              {(annonce.equipementsPerso||[]).filter(eq=>eq.actif).map(eq=>(
                <div key={eq.id} style={{ display:"flex", alignItems:"center", gap:5, background:"#e8f6fe", borderRadius:20, padding:"5px 12px", fontSize:12, fontWeight:600, color:"#07a0f2" }}>
                  {eq.emoji} {eq.label}
                </div>
              ))}
            </div>
          </div>

          {/* Règlement */}
          <div style={{ ...card, marginBottom:14 }}>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", fontWeight:700, marginBottom:12 }}>📋 Règlement</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {[["enfants","👶","Enfants 0-12 ans"],["naturisme","🧘","Naturisme"],["burkini","👙","Burkini"],
                ["evenements","🎉","Événements"],["alcool","🍷","Alcool"],["fumeur","🚬","Fumeur"],
                ["animaux","🐾","Animaux"],["musique","🎵","Musique"]].map(([k,emoji,label])=>(
                <div key={k} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12 }}>
                  <span style={{ fontSize:16 }}>{emoji}</span>
                  <span style={{ color:"#2C3E50", fontWeight:600 }}>{label}</span>
                  <span style={{ marginLeft:"auto", color:annonce.reglement[k]?"#39b8f5":"#FF6B6B", fontWeight:700, fontSize:14 }}>
                    {annonce.reglement[k]?"✓":"✗"}
                  </span>
                </div>
              ))}
            </div>
            {annonce.precisions && annonce.precisions.length > 0 && (
              <div style={{ marginTop:12, background:"#f0f9ff", borderRadius:8, padding:"12px", border:"1px solid #b8e0f8", maxHeight:240, overflowY:"auto" }}>
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
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, color:"#07a0f2", fontWeight:700, marginBottom:10 }}>🛡️ Dispositifs de sécurité</div>
            <div style={{ fontSize:12, color:"#6b7f8c", marginBottom:8 }}>Conformité loi du 03/01/2003 :</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {[["barriere","🚧","Barrière de protection"],["bache","🟦","Bâche de sécurité"],
                ["abri","🏠","Abri de piscine"],["alarme","🔔","Alarme de sécurité"]].map(([k,emoji,label])=>(
                <div key={k} style={{ display:"flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600, background:annonce.dispositifs[k]?"#e8f6fe":"#f5f5f5", color:annonce.dispositifs[k]?"#07a0f2":"#bbb", border:`1px solid ${annonce.dispositifs[k]?"#39b8f5":"#e0e0e0"}` }}>
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
  if (mode === "confidentialite" || mode === "cgu" || mode === "mentions" || mode === "accessibilite") {
    const pagesLegales = {
      confidentialite: ["🔒 Politique de confidentialité", POLITIQUE_CONFIDENTIALITE],
      cgu: ["📜 Conditions générales de vente et d'utilisation", CGU_TEXTE],
      mentions: ["🏛️ Mentions légales", MENTIONS_LEGALES],
      accessibilite: ["♿ Déclaration d'accessibilité", DECLARATION_ACCESSIBILITE],
    };
    const [titreLegal, texteLegal] = pagesLegales[mode];
    return (
      <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
        <Header showSteps={false} />
        <main style={{ padding: "16px 16px 32px" }}>
          <div style={card}>
            <h1 style={{ fontFamily:"'Nunito',sans-serif", fontSize:19, color:"#07a0f2", fontWeight:700, marginBottom:14, marginTop:0 }}>
              {titreLegal}
            </h1>
            {/* tabIndex 0 : la zone défilante doit rester atteignable au clavier */}
            <div tabIndex={0} style={{ background:"#f0f9ff", borderRadius:10, padding:"14px 16px", fontSize:13, color:"#2C3E50", lineHeight:1.7, whiteSpace:"pre-line", border:"1px solid #b8e0f8", maxHeight:480, overflowY:"auto" }}>
              {texteLegal}
            </div>
            {/* Navigation entre les pages légales */}
            <nav aria-label="Autres pages légales" style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:14 }}>
              {Object.entries(pagesLegales).filter(([k]) => k !== mode).map(([k, [titre]]) => (
                <button key={k} onClick={() => setMode(k)}
                  style={{ padding:"7px 14px", borderRadius:50, background:"#fff", color:"#07a0f2", border:"1.5px solid #b8e0f8", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                  {titre}
                </button>
              ))}
            </nav>
          </div>
          <button style={btnS} onClick={() => setMode(modeOrigineAvantLegal)}>← Retour</button>
        </main>
      </div>
    );
  }

  // ── PAGE ACCUEIL ──────────────────────────────────────────────────────────
  if (mode === "accueil") {
    const prochaine = compteConnecte
      ? reservations.filter(r => r.email?.toLowerCase() === compteConnecte.toLowerCase() && r.date >= today() && r.statut !== "annulee" && r.statut !== "refusee").sort((a,b) => a.date.localeCompare(b.date))[0]
      : null;
    // Réservation en cours maintenant (session active)
    const heureNow = new Date().getHours() + new Date().getMinutes() / 60;
    const sessionEnCours = compteConnecte
      ? reservations.find(r =>
          r.email?.toLowerCase() === compteConnecte.toLowerCase() &&
          r.date === today() &&
          r.statut === "acceptee" &&
          parseFloat(r.heureDebut) <= heureNow &&
          parseFloat(r.heureFin) > heureNow
        )
      : null;
    return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding: "16px 16px 32px" }}>
        {retourPaiement && (
          <div style={{ background: "#e8f6fe", border: "2px solid #39b8f5", borderRadius: 12, padding: "14px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 14, color: "#07a0f2", lineHeight: 1.5 }}>
              ✅ <strong>Paiement bien reçu !</strong> Votre réservation{retourPaiement.ref ? ` ${retourPaiement.ref}` : ""} est définitivement confirmée. Un récapitulatif est disponible dans « Mon compte ».
            </div>
            <button onClick={() => setRetourPaiement(null)} style={{ background: "transparent", border: "none", color: "#07a0f2", fontSize: 18, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>✕</button>
          </div>
        )}
        <div style={{ ...card, textAlign: "center" }}>
          {compteConnecte ? (
            // ── Accueil locataire connecté ──
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👋</div>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize: 20, fontWeight: 700, color: "#07a0f2", marginBottom: 4 }}>
                Bonjour {comptes[compteConnecte]?.prenom} !
              </div>
              {sessionEnCours ? (
                // Session active en ce moment
                <div style={{ background: "#07a0f2", borderRadius: 14, padding: "16px", margin: "12px 0", color: "#fff" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>🏊 Session en cours !</div>
                  <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 12 }}>{sessionEnCours.ref} · {padH(sessionEnCours.heureDebut)} → {padH(sessionEnCours.heureFin)}</div>
                  {!sessionEnCours.edlEntreeFait ? (
                    <button onClick={() => { setReservation(sessionEnCours); setMode("edlEntree"); }}
                      style={{ width: "100%", padding: "11px", borderRadius: 10, background: "#fff", color: "#07a0f2", border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                      📷 Faire l'état des lieux d'entrée
                    </button>
                  ) : !sessionEnCours.edlSortieFait ? (
                    <button onClick={() => { setReservation(sessionEnCours); setMode("edlSortie"); }}
                      style={{ width: "100%", padding: "11px", borderRadius: 10, background: "#fff", color: "#07a0f2", border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                      📷 Faire l'état des lieux de sortie
                    </button>
                  ) : (
                    <div style={{ background: "rgba(255,255,255,.2)", borderRadius: 10, padding: "10px", textAlign: "center", fontSize: 13 }}>
                      ✅ États des lieux complétés
                    </div>
                  )}
                </div>
              ) : prochaine ? (
                <div style={{ background: prochaine.statut === "acceptee" ? "#e8f6fe" : "#fff8e1", border: `2px solid ${prochaine.statut === "acceptee" ? "#39b8f5" : "#f0c040"}`, borderRadius: 12, padding: "12px 14px", margin: "14px 0", textAlign: "left" }}>
                  <div style={{ fontSize: 12, color: "#6b7f8c", marginBottom: 4 }}>
                    {prochaine.statut === "acceptee" ? "✅ Prochaine réservation confirmée" : "⏳ Demande en attente de validation"}
                  </div>
                  <div style={{ fontWeight: 700, color: "#07a0f2", fontSize: 14 }}>{prochaine.ref}</div>
                  <div style={{ fontSize: 13, color: "#2C3E50" }}>📅 {prochaine.date} · {padH(prochaine.heureDebut)} → {padH(prochaine.heureFin)}</div>
                  <div style={{ fontSize: 12, color: "#6b7f8c", marginTop: 4 }}>{prochaine.adultes} adulte{prochaine.adultes > 1 ? "s" : ""}{prochaine.enfants12 > 0 ? ` + ${prochaine.enfants12} enfant` : ""} · {formatEur(prochaine.totalGeneral || prochaine.prix)}</div>
                </div>
              ) : (
                <div style={{ color: "#6b7f8c", fontSize: 13, margin: "12px 0" }}>Vous n'avez pas de réservation à venir.</div>
              )}
              <BanniereInstallation />
              <button style={{ ...btnP, marginBottom: 10 }} onClick={() => setMode("annonce")}>🏊 Réserver un créneau</button>
              <button style={{ ...btnS }} onClick={() => setMode("compte")}>📋 Mes réservations</button>
              <button style={{ ...btnS, marginTop: 10, color: "#c0302a", borderColor: "#c0302a", fontSize: 12, padding: "8px 20px" }} onClick={() => { setCompteConnecte(null); }}>
                Déconnexion
              </button>
            </>
          ) : (
            // ── Accueil visiteur ──
            <>
              <div style={{ fontSize: 14, color: "#6b7f8c", marginBottom: 18, lineHeight: 1.6 }}>Bienvenue ! Réservez notre piscine privée ou accédez à votre espace.</div>
              <BanniereInstallation />
              <button style={btnP} onClick={() => setMode("annonce")}>🏊 Voir l'annonce & Réserver</button>
              <button style={{ ...btnS, marginTop: 10 }} onClick={() => { setAuthMode("login"); setMode("auth"); }}>👤 Se connecter / Créer un compte</button>
            </>
          )}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e0eef2", display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button style={{ background:"none", border:"1px solid #b8e0f8", borderRadius:8, padding:"6px 14px", fontSize:12, color:"#07a0f2", cursor:"pointer" }} onClick={() => setMode(proprioConnecte || adminConnecte ? "proprio" : "loginProprio")}>🔑 Espace propriétaire</button>
            <button style={{ background:"none", border:"1px solid #ddd", borderRadius:8, padding:"6px 14px", fontSize:11, color:"#aaa", cursor:"pointer" }} onClick={() => setMode(adminConnecte ? "proprio" : "loginAdmin")}>⚙️ Admin</button>
          </div>
        </div>
        {(proprioConnecte || adminConnecte) && (
          <div style={card}>
            <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 17, color: "#07a0f2", marginBottom: 4, fontWeight: 700 }}>Infos pratiques</div>
            <div style={{ fontSize: 11, color: "#aaa", marginBottom: 10 }}>Visible uniquement par vous, aide-mémoire</div>
            {[["💧", "Piscine privée", "Accès exclusif pendant votre créneau"], ["👥", "Tarifs", "9 €/pers/h · -50% enfants 3–11 ans · gratuit -3 ans"], ["⏱️", "Créneaux", "Choisissez librement vos horaires"], ["🧹", "Nettoyage", "1h de battement automatique entre chaque location"]].map(([icon, title, desc]) => (
              <div key={title} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 19 }}>{icon}</span>
                <div><div style={{ fontWeight: 600, fontSize: 13, color: "#2C3E50" }}>{title}</div><div style={{ fontSize: 12, color: "#6b7f8c" }}>{desc}</div></div>
              </div>
            ))}
          </div>
        )}
        {/* Pied de page légal — obligations d'information (LCEN, RGPD, accessibilité).
            De vrais <button> plutôt que des <span> : navigables au clavier et
            annoncés correctement par les lecteurs d'écran. */}
        <footer style={{ textAlign:"center", marginTop:18, fontSize:12, color:"#6b7f8c", lineHeight:1.9 }}>
          <nav aria-label="Informations légales" style={{ display:"flex", flexWrap:"wrap", gap:"4px 10px", justifyContent:"center" }}>
            {[
              ["mentions", "Mentions légales"],
              ["confidentialite", "Confidentialité"],
              ["cgu", "CGV / CGU"],
              ["accessibilite", "Accessibilité"],
            ].map(([cle, libelle]) => (
              <button key={cle} onClick={() => { setModeOrigineAvantLegal("accueil"); setMode(cle); }}
                style={{ background:"none", border:"none", padding:"2px 4px", color:"#0480c4", fontSize:12, fontFamily:"inherit", cursor:"pointer", textDecoration:"underline" }}>
                {libelle}
              </button>
            ))}
          </nav>
          <div style={{ marginTop:6, fontSize:11, color:"#6b7f8c" }}>
            {SOCIETE_NOM} — {SOCIETE_FORME} au capital de {SOCIETE_CAPITAL}<br />
            {SOCIETE_ADRESSE} — {SOCIETE_RCS}
          </div>
        </footer>
      </div>
    </div>
  );
  }

  // ── PAGE AUTH ─────────────────────────────────────────────────────────────
  if (mode === "auth") {
    // Honeypot : champ caché, les robots le remplissent, les humains non
    const honeypotStyle = { position:"absolute", left:"-9999px", opacity:0, height:0, overflow:"hidden" };
    const champOeil = (key, val, onChange, placeholder) => (
      <div style={{ position:"relative" }}>
        <input style={{ ...inp, paddingRight:42 }} type={showMdp[key] ? "text" : "password"} value={val} onChange={onChange} placeholder={placeholder || "••••••••"} autoComplete="new-password"/>
        <button type="button" onClick={()=>setShowMdp(p=>({...p,[key]:!p[key]}))}
          style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:18, color:"#6b7f8c", padding:2 }}>
          {showMdp[key] ? "🙈" : "👁️"}
        </button>
      </div>
    );
    return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#f8f9fa", minHeight:"100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding:"16px 16px 40px", maxWidth:480, margin:"0 auto" }}>
        <div style={{ display:"flex", gap:0, marginBottom:14, background:"#e8f4f7", borderRadius:10, padding:4 }}>
          {[["login","Se connecter"],["register","Créer un compte"]].map(([v,label]) => (
            <button key={v} onClick={()=>{setAuthMode(v);setAuthErreur("");}} style={{ flex:1, padding:"9px", borderRadius:8, border:"none", background:authMode===v?"#07a0f2":"transparent", color:authMode===v?"#fff":"#07a0f2", fontWeight:700, fontSize:13, cursor:"pointer" }}>{label}</button>
          ))}
        </div>
        <div style={card}>

          {/* ── INSCRIPTION ── */}
          {authMode === "register" && (<>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div><label style={lbl}>Prénom *</label><input style={inp} value={authForm.prenom} onChange={e=>setAuthForm(f=>({...f,prenom:e.target.value}))}/></div>
              <div><label style={lbl}>Nom *</label><input style={inp} value={authForm.nom} onChange={e=>setAuthForm(f=>({...f,nom:e.target.value}))}/></div>
            </div>
            <div style={{ marginBottom:10 }}><label style={lbl}>Téléphone *</label><input style={inp} type="tel" value={authForm.telephone} onChange={e=>setAuthForm(f=>({...f,telephone:e.target.value}))}/></div>
            <div style={{ marginBottom:10 }}><label style={lbl}>Adresse *</label><input style={inp} placeholder="N° et nom de rue" value={authForm.adresse||""} onChange={e=>setAuthForm(f=>({...f,adresse:e.target.value}))}/></div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10, marginBottom:10 }}>
              <div><label style={lbl}>Code postal *</label><input style={inp} placeholder="49000" maxLength={5} value={authForm.codePostal||""} onChange={e=>setAuthForm(f=>({...f,codePostal:e.target.value.replace(/\D/g,"")}))} /></div>
              <div><label style={lbl}>Ville *</label><input style={inp} placeholder="Angers" value={authForm.ville||""} onChange={e=>setAuthForm(f=>({...f,ville:e.target.value}))}/></div>
            </div>
          </>)}

          {/* Email + détection compte existant */}
          <div style={{ marginBottom:10 }}>
            <label style={lbl}>Email *</label>
            <input style={inp} type="email" value={authForm.email}
              onChange={e=>{
                setAuthForm(f=>({...f,email:e.target.value}));
                // Détecter si l'email existe déjà (lors de l'inscription)
                if (authMode==="register" && comptes[e.target.value.trim().toLowerCase()]) {
                  setAuthErreur("⚠️ Un compte existe déjà avec cet email. Connectez-vous plutôt !");
                } else { setAuthErreur(""); }
              }}/>
          </div>

          {/* Détection compte existant → proposition de connexion */}
          {authMode === "register" && authForm.email && comptes[authForm.email.trim().toLowerCase()] && (
            <div style={{ background:"#fff8e1", border:"2px solid #f0c040", borderRadius:10, padding:"12px 14px", marginBottom:12 }}>
              <div style={{ fontWeight:700, color:"#a06000", fontSize:13, marginBottom:6 }}>👤 Vous avez déjà un compte !</div>
              <div style={{ fontSize:12, color:"#6b7f8c", marginBottom:10 }}>Un compte existe pour <strong>{authForm.email}</strong>. Connectez-vous pour retrouver toutes vos réservations.</div>
              <button onClick={()=>{setAuthMode("login");setAuthErreur("");}}
                style={{ width:"100%", padding:"10px", borderRadius:8, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                → Se connecter à mon compte
              </button>
            </div>
          )}

          {/* Mot de passe */}
          <div style={{ marginBottom:10 }}>
            <label style={lbl}>Mot de passe {authMode==="register" ? "* (8 caractères min.)" : ""}</label>
            {champOeil("login", authForm.motdepasse, e=>setAuthForm(f=>({...f,motdepasse:e.target.value})))}
          </div>

          {/* Confirmation mot de passe — en dessous, pas à côté */}
          {authMode === "register" && (
            <div style={{ marginBottom:14 }}>
              <label style={lbl}>Confirmer le mot de passe *</label>
              {champOeil("mdp2", authForm.motdepasse2, e=>setAuthForm(f=>({...f,motdepasse2:e.target.value})))}
              {authForm.motdepasse2 && authForm.motdepasse !== authForm.motdepasse2 && (
                <div style={{ color:"#FF6B6B", fontSize:12, marginTop:4 }}>❌ Les mots de passe ne correspondent pas</div>
              )}
              {authForm.motdepasse2 && authForm.motdepasse === authForm.motdepasse2 && authForm.motdepasse.length >= 8 && (
                <div style={{ color:"#39b8f5", fontSize:12, marginTop:4 }}>✅ Mots de passe identiques</div>
              )}
            </div>
          )}

          {/* Honeypot anti-robot (champ invisible) */}
          {authMode === "register" && (
            <div style={honeypotStyle} aria-hidden="true">
              <input tabIndex={-1} autoComplete="off" value={authForm._hp||""} onChange={e=>setAuthForm(f=>({...f,_hp:e.target.value}))} />
            </div>
          )}

          {/* CGU */}
          {authMode === "register" && (
            <label style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:14, cursor:"pointer" }}>
              <input type="checkbox" checked={authForm.cguAcceptees||false} onChange={e=>setAuthForm(f=>({...f,cguAcceptees:e.target.checked}))} style={{ marginTop:3, width:16, height:16, accentColor:"#07a0f2", flexShrink:0 }}/>
              <span style={{ fontSize:12, color:"#6b7f8c", lineHeight:1.6 }}>
                J'accepte les{" "}
                <span onClick={e=>{e.preventDefault();e.stopPropagation();setModeOrigineAvantLegal("auth");setMode("cgu");}} style={{ color:"#07a0f2", fontWeight:600, textDecoration:"underline", cursor:"pointer" }}>CGU</span>
                {" "}et la{" "}
                <span onClick={e=>{e.preventDefault();e.stopPropagation();setModeOrigineAvantLegal("auth");setMode("confidentialite");}} style={{ color:"#07a0f2", fontWeight:600, textDecoration:"underline", cursor:"pointer" }}>politique de confidentialité</span>
              </span>
            </label>
          )}

          {authErreur && <div style={{ color:"#FF6B6B", fontSize:13, marginBottom:10, padding:"8px 10px", background:"#fff0f0", borderRadius:8 }}>{authErreur}</div>}
          {authMode==="login" && estBloque("locataire") && (
            <div style={{ background:"#fff3cd", border:"1px solid #f0c040", borderRadius:8, padding:"10px 12px", fontSize:13, color:"#a06000", marginBottom:10 }}>
              🔒 Compte bloqué encore {tempsRestant("locataire")} min. Utilisez « Mot de passe oublié ».
            </div>
          )}
          <button
            style={{ ...btnP, opacity:(authMode==="register"&&(!authForm.cguAcceptees||authForm._hp))||(authMode==="login"&&estBloque("locataire"))?.4:1 }}
            disabled={(authMode==="register"&&(!authForm.cguAcceptees||!!authForm._hp))||(authMode==="login"&&estBloque("locataire"))}
            onClick={authMode==="login" ? connecter : inscrire}>
            {authMode==="login" ? "Se connecter" : "Créer mon compte"}
          </button>
          {authMode==="login" && (
            <button onClick={()=>{setResetEmail(authForm.email||"");ouvrirReset("locataire");}}
              style={{ background:"none", border:"none", color:"#6b7f8c", fontSize:13, cursor:"pointer", textDecoration:"underline", width:"100%", marginTop:8 }}>
              Mot de passe oublié ?
            </button>
          )}
        </div>
        <button style={btnS} onClick={()=>setMode("accueil")}>← Accueil</button>
      </div>
    </div>
    );
  }
  // ── PAGE COMPTE LOCATAIRE ─────────────────────────────────────────────────
  if (mode === "compte") {
    const compte = comptes[compteConnecte];
    const aujourdhuiCompte = today();
    // Même classement que côté propriétaire, pour que le client s'y retrouve
    const categorieResa = r => {
      const st = r.statut || "acceptee";
      if (st === "en_attente") return "attente";
      if (st === "refusee" || st === "annulee") return "autres";
      return r.date >= aujourdhuiCompte ? "avenir" : "passees";
    };
    const mesResToutes = reservations.filter(r => r.email && r.email.toLowerCase() === (compteConnecte || "").toLowerCase());
    const parCat = { attente: [], avenir: [], passees: [], autres: [] };
    mesResToutes.forEach(r => parCat[categorieResa(r)].push(r));

    const ongletsClient = [
      ["attente", "En attente", parCat.attente.length],
      ["avenir", "À venir", parCat.avenir.length],
      ["passees", "Passées", parCat.passees.length],
      ["autres", "Autres", parCat.autres.length],
    ];
    // À l'ouverture, on montre la première catégorie non vide en partant des
    // plus utiles : ce qui arrive bientôt, puis ce qui attend une réponse.
    const filtreEffectif = parCat[filtreMesResas].length > 0
      ? filtreMesResas
      : (["avenir", "attente", "passees", "autres"].find(c => parCat[c].length > 0) || "avenir");

    const decroissant = filtreEffectif === "passees" || filtreEffectif === "autres";
    const mesRes = [...parCat[filtreEffectif]].sort((a, b) => {
      const c = a.date.localeCompare(b.date);
      if (c !== 0) return decroissant ? -c : c;
      return (a.heureDebut || 0) - (b.heureDebut || 0);
    });
    const messageVideClient = {
      attente: "Aucune demande en attente de réponse.",
      avenir: "Aucune réservation à venir. À bientôt à la piscine ! 🏊",
      passees: "Aucune réservation passée.",
      autres: "Aucune réservation refusée ou annulée.",
    }[filtreEffectif];
    return (
      <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
        <Header showSteps={false} />
        <div style={{ padding: "16px 16px 32px" }}>
          <button onClick={() => setMode("accueil")}
            style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", color:"#07a0f2", fontWeight:600, fontSize:14, cursor:"pointer", marginBottom:14, padding:0 }}>
            ← Retour à l'accueil
          </button>
          <div style={card}>
            <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 18, color: "#07a0f2", fontWeight: 700, marginBottom: 12 }}>👤 Mon compte</div>
            <div style={{ fontSize: 14, color: "#2C3E50", lineHeight: 2 }}>
              <strong>{compte?.prenom} {compte?.nom}</strong><br />
              📧 {compte?.email}<br />
              📞 {compte?.telephone}<br />
              {compte?.adresse && <>{compte.adresse}<br /></>}
              {(compte?.codePostal || compte?.ville) && <span style={{color:"#6b7f8c"}}>📍 {compte?.codePostal} {compte?.ville}</span>}
            </div>
          </div>
          <div style={card}>
            <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 18, color: "#07a0f2", fontWeight: 700, marginBottom: 12 }}>📋 Mes réservations</div>
            {mesResToutes.length > 0 && (
              <div role="tablist" aria-label="Filtrer mes réservations" style={{ display:"flex", flexWrap:"wrap", gap:7, marginBottom:14 }}>
                {ongletsClient.map(([cle, libelle, nombre]) => {
                  const actif = filtreEffectif === cle;
                  return (
                    <button key={cle} role="tab" aria-selected={actif} onClick={() => setFiltreMesResas(cle)}
                      style={{ padding:"6px 14px", borderRadius:50, fontSize:12.5, fontWeight:700, cursor:"pointer",
                        border:`1.5px solid ${actif ? "#07a0f2" : "#b8e0f8"}`,
                        background: actif ? "#07a0f2" : "#fff",
                        color: actif ? "#fff" : "#07a0f2",
                        opacity: nombre === 0 && !actif ? 0.5 : 1 }}>
                      {libelle} <span style={{ fontSize:11, opacity:.8 }}>({nombre})</span>
                    </button>
                  );
                })}
              </div>
            )}
            {mesResToutes.length === 0 ? (
              <div style={{ color: "#6b7f8c", fontSize: 14, textAlign: "center", padding: "16px 0" }}>Aucune réservation pour l'instant.</div>
            ) : mesRes.length === 0 ? (
              <div style={{ color: "#6b7f8c", fontSize: 14, textAlign: "center", padding: "20px 0" }}>{messageVideClient}</div>
            ) : mesRes.map(r => {
              const noteP = notesLocataires[r.ref];
              const showFacture = factureOuverte === r.ref;
              const extrasRes = extras.filter(e => r.extrasChoisis?.[e.id]);
              return (
                <div key={r.ref} style={{ background: "#f0f9ff", borderRadius: 10, padding: "12px 14px", marginBottom: 10, border: "1px solid #b8e0f8" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#07a0f2", fontSize: 13 }}>{r.ref}</div>
                      <div style={{ fontSize: 12, color: "#6b7f8c" }}>{r.date} · {padH(r.heureDebut ?? parseInt(r.heureDebut))} → {padH(r.heureFin ?? parseInt(r.heureFin))}</div>
                      <div style={{ fontSize: 12, color: "#6b7f8c" }}>{r.adultes} adulte{r.adultes > 1 ? "s" : ""}{r.enfants12 > 0 ? ` + ${r.enfants12} enfant` : ""} · {formatEur(r.totalGeneral || r.prix)}</div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                      {/* Badge statut validation */}
                      {(() => {
                        const s = r.statut || "en_attente";
                        const cfg = {
                          en_attente: { bg:"#fff8e1", color:"#a06000", border:"#f0c040", label:"⏳ En attente" },
                          acceptee:   { bg:"#e8f6fe", color:"#07a0f2", border:"#39b8f5", label:"✅ Confirmée" },
                          refusee:    { bg:"#fff0f0", color:"#c0302a", border:"#FF6B6B", label:"✗ Non acceptée" },
                          annulee:    { bg:"#f5f5f5", color:"#888",    border:"#ccc",    label:"🚫 Annulée" },
                        }[s] || { bg:"#f0f9ff", color:"#07a0f2", border:"#b8e0f8", label:"—" };
                        return (
                          <span style={{ fontSize:11, padding:"3px 9px", borderRadius:20, background:cfg.bg, color:cfg.color, border:`1px solid ${cfg.border}`, fontWeight:700 }}>
                            {cfg.label}
                          </span>
                        );
                      })()}
                      {/* Badge à venir / passée */}
                      <span style={{ fontSize:11, padding:"3px 8px", borderRadius:20, background: r.date >= today() ? "#f0f9ff" : "#f0f0f0", color: r.date >= today() ? "#07a0f2" : "#888", fontWeight:600 }}>
                        {r.date >= today() ? "À venir" : "Passée"}
                      </span>
                    </div>
                  </div>

                  {/* Message contextuel selon statut */}
                  {r.statut === "en_attente" && (
                    <div style={{ marginTop:10, background:"#fff8e1", borderRadius:8, padding:"9px 12px", fontSize:12, color:"#a06000", lineHeight:1.5 }}>
                      🕐 Votre demande est en attente de validation par le propriétaire. Vous recevrez un email dès qu'elle sera traitée.
                    </div>
                  )}
                  {/* Paiement en attente après acceptation */}
                  {r.statut === "acceptee" && r.paiement && r.paiement.statut !== "paye" && r.paiement.url && (
                    <div style={{ marginTop:10, background:"#f0f9ff", border:"1.5px solid #39b8f5", borderRadius:8, padding:"12px", fontSize:12, color:"#07a0f2", lineHeight:1.5 }}>
                      💳 <strong>Dernière étape :</strong> réglez {formatEur(r.paiement.montant)} pour confirmer définitivement votre réservation.
                      {r.modePaiement === "especes" && (
                        <div style={{ marginTop:4, color:"#6b7f8c" }}>
                          Acompte de 20% — le solde de {formatEur((r.totalGeneral || r.prix || 0) - r.paiement.montant)} sera à régler en espèces sur place.
                        </div>
                      )}
                      <a href={r.paiement.url} target="_blank" rel="noopener noreferrer"
                        style={{ display:"block", textAlign:"center", background:"#07a0f2", color:"#fff", textDecoration:"none", fontWeight:700, fontSize:13, padding:"10px 0", borderRadius:8, marginTop:8 }}>
                        Payer {formatEur(r.paiement.montant)} en ligne
                      </a>
                      <div style={{ marginTop:8, background:"#fff8e1", borderRadius:6, padding:"8px 10px", color:"#a06000", fontSize:11 }}>
                        ⏱️ Créneau non garanti tant que le paiement n'est pas reçu — le premier qui règle l'obtient.
                      </div>
                    </div>
                  )}
                  {/* Paiement effectué */}
                  {r.paiement?.statut === "paye" && (
                    <div style={{ marginTop:10, background:"#e8f6fe", border:"1px solid #39b8f5", borderRadius:8, padding:"9px 12px", fontSize:12, color:"#07a0f2", lineHeight:1.5 }}>
                      ✅ Paiement de <strong>{formatEur(r.paiement.montantPaye || r.paiement.montant)}</strong> bien reçu{r.paiement.datePaiement ? ` le ${new Date(r.paiement.datePaiement).toLocaleDateString("fr-FR")}` : ""}.
                      {r.modePaiement === "especes" && (
                        <> Solde de {formatEur((r.totalGeneral || r.prix || 0) - (r.paiement.montantPaye || r.paiement.montant))} à régler en espèces sur place.</>
                      )}
                    </div>
                  )}
                  {r.statut === "refusee" && (
                    <div style={{ marginTop:10, background:"#fff0f0", borderRadius:8, padding:"9px 12px", fontSize:12, color:"#c0302a", lineHeight:1.5 }}>
                      Le propriétaire n'a pas pu accepter votre demande.{r.motifRefus ? ` Motif : "${r.motifRefus}"` : ""} Vous serez remboursé(e) intégralement.
                    </div>
                  )}
                  {r.statut === "annulee" && (
                    <div style={{ marginTop:10, background:"#f5f5f5", borderRadius:8, padding:"9px 12px", fontSize:12, color:"#888", lineHeight:1.5 }}>
                      🚫 Réservation annulée.{r.motifAnnulation ? ` Motif : "${r.motifAnnulation}"` : ""}
                      {r.montantRembourse !== undefined && (
                        <div style={{ marginTop:4 }}>
                          {r.montantRetenu > 0
                            ? <>💸 Retenu : <strong>{formatEur(r.montantRetenu)}</strong> · Remboursé : <strong>{formatEur(r.montantRembourse)}</strong></>
                            : <>✅ Remboursement intégral : <strong>{formatEur(r.montantRembourse)}</strong></>
                          }
                        </div>
                      )}
                    </div>
                  )}

                  {/* Bouton annulation locataire — uniquement si statut en_attente ou acceptee et pas encore commencée */}
                  {(r.statut === "en_attente" || r.statut === "acceptee") && (() => {
                    const pen = calculerPenalite(r);
                    if (pen.impossible) return null;
                    return annulLocRef === r.ref ? (
                      <div style={{ marginTop:10, background:"#fff0f0", border:"2px solid #FF6B6B", borderRadius:10, padding:"12px 14px" }}>
                        <div style={{ fontWeight:700, color:"#c0302a", fontSize:13, marginBottom:6 }}>Confirmer l'annulation</div>
                        <div style={{ fontSize:12, color:"#c0302a", background:"#fff8f8", borderRadius:8, padding:"8px 10px", marginBottom:10, lineHeight:1.6 }}>
                          ⚠️ {pen.label}<br/>
                          {pen.taux > 0
                            ? <>Montant retenu : <strong>{formatEur(pen.retenu)}</strong> · Remboursé : <strong>{formatEur(pen.rembourse)}</strong></>
                            : <strong>Vous serez remboursé(e) intégralement.</strong>
                          }
                        </div>
                        <label style={{ fontSize:12, color:"#6b7f8c", marginBottom:6, display:"block" }}>Motif (optionnel)</label>
                        <input value={annulLocMotif} onChange={e=>setAnnulLocMotif(e.target.value)}
                          style={{ width:"100%", padding:"9px 10px", borderRadius:8, border:"1.5px solid #FFb0b0", fontSize:13, marginBottom:10, boxSizing:"border-box" }}
                          placeholder="Raison de l'annulation..."/>
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={()=>annulerParLocataire(r.ref)}
                            style={{ flex:1, padding:"10px", borderRadius:8, background:"#FF6B6B", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                            ✗ Confirmer l'annulation
                          </button>
                          <button onClick={()=>{ setAnnulLocRef(null); setAnnulLocMotif(""); }}
                            style={{ flex:1, padding:"10px", borderRadius:8, background:"#e8f4f7", color:"#07a0f2", border:"none", fontWeight:600, fontSize:13, cursor:"pointer" }}>
                            Garder ma réservation
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={()=>setAnnulLocRef(r.ref)}
                        style={{ marginTop:10, width:"100%", padding:"9px", borderRadius:8, background:"none", border:"1.5px solid #FF6B6B", color:"#c0302a", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                        ✗ Annuler cette réservation
                      </button>
                    )
                  })()}
                    <div style={{ display:"flex", gap:8, marginTop:10 }}>
                      {!r.edlEntreeFait && (
                        <button onClick={() => { setReservation(r); setMode("edlEntree"); }}
                          style={{ flex:1, padding:"9px", borderRadius:8, background:"#39b8f5", color:"#fff", border:"none", fontWeight:700, fontSize:12, cursor:"pointer" }}>
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
                        <div style={{ flex:1, padding:"9px", borderRadius:8, background:"#e8f6fe", color:"#07a0f2", textAlign:"center", fontWeight:600, fontSize:12 }}>
                          ✓ États des lieux complétés
                        </div>
                      )}
                    </div>
                    {/* Avis accessible après coup : si la session est terminée et pas encore notée */}
                    {r.edlSortieFait && !r.note && (
                      <button onClick={() => { setReservation(r); setNote(0); setCommentaire(""); setAvisEnvoye(false); setMode("locataire"); setStep(7); }}
                        style={{ width:"100%", marginTop:8, padding:"9px", borderRadius:8, background:"#f0c040", color:"#fff", border:"none", fontWeight:700, fontSize:12, cursor:"pointer" }}>
                        ⭐ Donner mon avis sur ma session
                      </button>
                    )}
                  {r.note && <div style={{ fontSize: 12, color: "#f0a500", marginTop: 4 }}>Votre avis : {"⭐".repeat(r.note)}</div>}
                  {noteP && (
                    <div style={{ fontSize: 12, marginTop: 4, color: noteP.note >= 4 ? "#07a0f2" : "#888" }}>
                      Note propriétaire : {"⭐".repeat(noteP.note)}
                      {r.codePromo && (
                        <div style={{ marginTop: 8, background: "#07a0f2", borderRadius: 10, padding: "10px 14px", textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: "#b8e8f0", marginBottom: 2 }}>🎁 Code promo -{r.codePromo.taux || 5}%</div>
                          <div style={{ fontSize: 17, fontWeight: 900, color: "#fff", fontFamily: "monospace", letterSpacing: 2 }}>{r.codePromo.code}</div>
                          <div style={{ fontSize: 11, color: "#b8e8f0", marginTop: 2 }}>Valable jusqu'au {r.codePromo.expiration} · usage unique</div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Bouton facture */}
                  <button onClick={() => setFactureOuverte(showFacture ? null : r.ref)}
                    style={{ marginTop:10, width:"100%", padding:"8px", borderRadius:8, background:showFacture?"#e8f4f7":"#07a0f2", color:showFacture?"#07a0f2":"#fff", border:showFacture?"1.5px solid #07a0f2":"none", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                    {showFacture ? "▲ Masquer la facture" : "🧾 Voir la facture / ticket"}
                  </button>
                  {/* Facture dépliable */}
                  {showFacture && (
                    <div style={{ marginTop:10, background:"#fff", borderRadius:10, padding:"16px", border:"2px solid #07a0f2" }}>
                      <div style={{ textAlign:"center", marginBottom:12 }}>
                        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, fontWeight:700, color:"#07a0f2" }}>🏊 My Piscine Privée</div>
                        <div style={{ fontSize:11, color:"#6b7f8c" }}>Écouflant · Maine-et-Loire</div>
                        <div style={{ height:1, background:"#07a0f2", margin:"8px 0" }}/>
                        <div style={{ fontSize:14, fontWeight:700, color:"#2C3E50", letterSpacing:.5 }}>FACTURE</div>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10, fontSize:11, fontFamily:"monospace" }}>
                        <div><span style={{ color:"#6b7f8c" }}>N° facture</span><br/><strong>{r.ref}</strong></div>
                        <div><span style={{ color:"#6b7f8c" }}>Émise le</span><br/><strong>{new Date().toLocaleDateString("fr-FR")}</strong></div>
                        <div style={{ marginTop:4 }}><span style={{ color:"#6b7f8c" }}>Client</span><br/><strong>{r.prenom} {r.nom}</strong></div>
                        <div style={{ marginTop:4 }}><span style={{ color:"#6b7f8c" }}>Session du</span><br/><strong>{r.date}</strong></div>
                      </div>
                      <div style={{ height:1, background:"#e0e0e0", margin:"8px 0" }}/>
                      <div style={{ fontSize:11, fontFamily:"monospace", marginBottom:8 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", fontWeight:700, color:"#6b7f8c", marginBottom:5, fontSize:10 }}>
                          <span>DÉSIGNATION</span><span>MONTANT</span>
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                          <div>
                            <div style={{ fontWeight:600 }}>Location piscine privée</div>
                            <div style={{ fontSize:10, color:"#6b7f8c" }}>{padH(r.heureDebut)} → {padH(r.heureFin)} · {r.adultes} adulte{r.adultes>1?"s":""}{r.enfants12>0?` + ${r.enfants12} enfant`:""}{r.moins3>0?` + ${r.moins3} bébé`:""}</div>
                            {r.creneaux?.some(h=>h>=20) && <div style={{ fontSize:10, color:"#a06000" }}>🌙 Majoration soirée incluse</div>}
                          </div>
                          <span style={{ fontWeight:600 }}>{formatEur(r.prix)}</span>
                        </div>
                        {extrasRes.map(e => {
                          const qte = r.extrasChoisis?.[e.id] || 0;
                          const nb = e.type==="personne" ? qte : 1;
                          const offert = e.id === "e1" && (r.prixBrut ?? r.prix) >= 30;
                          return (
                            <div key={e.id} style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                              <div>
                                <div style={{ fontWeight:600 }}>{e.emoji} {e.nom}</div>
                                <div style={{ fontSize:10, color:"#6b7f8c" }}>{e.type==="personne"?`${e.tarif}€ × ${nb}`:"Forfait"}</div>
                              </div>
                              <span style={{ fontWeight:600, color: offert ? "#39b8f5" : "inherit" }}>{offert ? "Gratuit 🎁" : formatEur(e.tarif*nb)}</span>
                            </div>
                          );
                        })}
                        {r.remiseFidelite > 0 && (
                          <div style={{ display:"flex", justifyContent:"space-between", color:"#07a0f2", fontWeight:700, marginBottom:4 }}>
                            <span>🎁 Remise fidélité -{r.remiseFidelite}%</span>
                            <span>offerte</span>
                          </div>
                        )}
                        {r.remise > 0 && (
                          <div style={{ display:"flex", justifyContent:"space-between", color:"#39b8f5", marginBottom:4 }}>
                            <span>Code promo -{r.remise}%</span>
                            <span>-{formatEur(r.prix*(r.remise/100))}</span>
                          </div>
                        )}
                      </div>
                      <div style={{ height:1, background:"#07a0f2", margin:"6px 0" }}/>
                      <div style={{ display:"flex", justifyContent:"space-between", fontWeight:700, fontSize:15, marginBottom:6, fontFamily:"monospace" }}>
                        <span>TOTAL</span>
                        <span style={{ color:"#07a0f2" }}>{formatEur(r.totalGeneral||r.prix)}</span>
                      </div>
                      <div style={{ fontSize:11, color:"#6b7f8c", fontFamily:"monospace", marginBottom:2 }}>
                        Mode : {r.modePaiement==="especes"?"Espèces (acompte 20% en ligne)":"Carte bancaire"}
                      </div>
                      {r.modePaiement==="especes" && (
                        <div style={{ fontSize:11, fontFamily:"monospace" }}>
                          <div style={{ display:"flex", justifyContent:"space-between" }}>
                            <span style={{ color:"#6b7f8c" }}>Acompte réglé</span>
                            <span style={{ fontWeight:600, color:"#39b8f5" }}>{formatEur(r.acompte)} ✓</span>
                          </div>
                          <div style={{ display:"flex", justifyContent:"space-between" }}>
                            <span style={{ color:"#6b7f8c" }}>Reste en espèces</span>
                            <span style={{ fontWeight:600, color:"#FF6B6B" }}>{formatEur(r.resteARegler)}</span>
                          </div>
                        </div>
                      )}
                      <div style={{ height:1, background:"#e0e0e0", margin:"10px 0" }}/>
                      <div style={{ textAlign:"center", fontSize:10, color:"#aaa", lineHeight:1.7 }}>
                        Document non soumis à TVA · Prestataire individuel<br/>
                        Merci de votre confiance — My Piscine Privée 🏊
                      </div>
                      <button onClick={() => window.print()} style={{ marginTop:10, width:"100%", padding:"8px", borderRadius:8, background:"#f0f9ff", color:"#07a0f2", border:"1.5px solid #07a0f2", fontSize:13, fontWeight:700, cursor:"pointer" }}>
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
        <div style={{ padding: "0 8px 24px" }}>
          <button style={{ width:"100%", padding:"12px", borderRadius:10, background:"transparent", border:"2px solid #07a0f2", color:"#07a0f2", fontWeight:700, fontSize:14, cursor:"pointer" }} onClick={() => setMode("accueil")}>← Retour à l'accueil</button>
        </div>
      </div>
    );
  }


  // ── PAGE LOGIN ADMIN ─────────────────────────────────────────────────────────
  // ── PAGE RÉINITIALISATION MOT DE PASSE ──────────────────────────────────────
  if (mode === "resetMdp") {
    const titres = { admin: "Administrateur", proprio: "Propriétaire", locataire: "Mon compte" };
    return (
      <div style={{ fontFamily:"Inter,sans-serif", background:"#f8f9fa", minHeight:"100vh" }}>
        <div style={{ background:"#07a0f2", paddingBottom:0 }}>
          <div style={{ padding:"28px 16px 8px", textAlign:"center" }}>
            <div style={{ fontSize:32 }}>🔐</div>
            <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:22, fontWeight:700, color:"#fff", marginTop:4 }}>Mot de passe oublié</div>
            <div style={{ color:"#b8e8f0", fontSize:12, marginTop:2 }}>Espace {titres[resetMode]}</div>
          </div>
          <Waves/>
        </div>
        <div style={{ padding:"24px 16px 32px" }}>
          <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"24px 20px", marginBottom:14 }}>

            {/* Étape 1 : saisie email */}
            {resetEtape === 1 && (<>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#07a0f2", fontWeight:700, marginBottom:8 }}>Vérification de votre identité</div>
              <div style={{ fontSize:13, color:"#6b7f8c", marginBottom:16 }}>
                Saisissez votre adresse email. Nous vous enverrons un code de vérification à 6 chiffres.
              </div>
              {resetMode === "locataire" && (
                <div style={{ marginBottom:12 }}>
                  <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Votre adresse email</label>
                  <input type="email" value={resetEmail} onChange={e=>{ setResetEmail(e.target.value); setResetErreur(""); }}
                    style={{ width:"100%", padding:"11px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #b8e0f8", boxSizing:"border-box" }}
                    placeholder="votre@email.fr"/>
                </div>
              )}
              {resetMode !== "locataire" && (
                <div style={{ background:"#f0f9ff", borderRadius:10, padding:"12px 14px", marginBottom:14, fontSize:13, color:"#07a0f2" }}>
                  📧 Un code sera envoyé à <strong>{resetEmail}</strong>
                </div>
              )}
              {resetErreur && <div style={{ color:"#FF6B6B", fontSize:13, marginBottom:10 }}>❌ {resetErreur}</div>}
              <button onClick={envoyerResetOTP}
                style={{ width:"100%", padding:"13px", borderRadius:10, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:15, cursor:"pointer", marginBottom:10 }}>
                📨 Envoyer le code de vérification
              </button>
            </>)}

            {/* Étape 2 : saisie du code */}
            {resetEtape === 2 && (<>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#07a0f2", fontWeight:700, marginBottom:8 }}>Entrez votre code</div>
              <div style={{ background:"#e8f6fe", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:13, color:"#07a0f2" }}>
                📧 Un code à 6 chiffres a été envoyé à <strong>{resetEmail}</strong>. Valable 15 minutes.
              </div>
              <input type="text" inputMode="numeric" maxLength={6} placeholder="Code à 6 chiffres"
                value={resetOtpSaisi} onChange={e=>{ setResetOtpSaisi(e.target.value.replace(/\D/g,"")); setResetErreur(""); }}
                style={{ width:"100%", padding:"14px", borderRadius:10, border:`2px solid ${resetErreur ? "#FF6B6B" : "#b8e0f8"}`, fontSize:28, fontWeight:900, letterSpacing:12, textAlign:"center", boxSizing:"border-box", marginBottom:10 }}/>
              {resetErreur && <div style={{ color:"#FF6B6B", fontSize:13, marginBottom:8 }}>❌ {resetErreur}</div>}
              <button onClick={validerResetOTP}
                style={{ width:"100%", padding:"13px", borderRadius:10, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:15, cursor:"pointer", marginBottom:10 }}>
                Valider le code →
              </button>
              <button onClick={()=>{ setResetEtape(1); setResetOtpSaisi(""); setResetErreur(""); }}
                style={{ background:"none", border:"none", color:"#6b7f8c", fontSize:13, cursor:"pointer", textDecoration:"underline" }}>
                Renvoyer le code
              </button>
            </>)}

            {/* Étape 3 : nouveau mot de passe */}
            {resetEtape === 3 && (resetMode === "admin" || resetMode === "proprio") && (<>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#07a0f2", fontWeight:700, marginBottom:8 }}>Changement via Vercel</div>
              <div style={{ fontSize:13, color:"#6b7f8c", marginBottom:14, lineHeight:1.6 }}>
                Pour votre sécurité, le mot de passe {resetMode === "admin" ? "administrateur" : "propriétaire"} ne peut plus être modifié depuis l'application — il vit uniquement dans les variables d'environnement de Vercel. Pour le changer : Vercel → Settings → Environment Variables → {resetMode === "admin" ? "ADMIN_PASSWORD" : "PROPRIO_PASSWORD"}, puis redéployez.
              </div>
              <button onClick={validerNouveauMdp}
                style={{ width:"100%", padding:"13px", borderRadius:10, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:15, cursor:"pointer" }}>
                J'ai compris
              </button>
            </>)}
            {resetEtape === 3 && resetMode === "locataire" && (<>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#07a0f2", fontWeight:700, marginBottom:8 }}>Nouveau mot de passe</div>
              <div style={{ fontSize:13, color:"#6b7f8c", marginBottom:14 }}>Choisissez un mot de passe sécurisé (8 caractères minimum).</div>
              <div style={{ marginBottom:10 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Nouveau mot de passe</label>
                <div style={{ position:"relative" }}>
                  <input type={voirResetMdp ? "text" : "password"} value={resetNouveauMdp} onChange={e=>{ setResetNouveauMdp(e.target.value); setResetErreur(""); }}
                    style={{ width:"100%", padding:"11px 40px 11px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #b8e0f8", boxSizing:"border-box" }}
                    placeholder="Minimum 8 caractères"/>
                  <button type="button" onClick={()=>setVoirResetMdp(v=>!v)}
                    style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:17, color:"#6b7f8c", padding:4 }}
                    aria-label={voirResetMdp ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
                    {voirResetMdp ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Confirmer le mot de passe</label>
                <div style={{ position:"relative" }}>
                  <input type={voirResetMdp ? "text" : "password"} value={resetNouveauMdp2} onChange={e=>{ setResetNouveauMdp2(e.target.value); setResetErreur(""); }}
                    style={{ width:"100%", padding:"11px 40px 11px 12px", borderRadius:8, fontSize:15, border:`1.5px solid ${resetErreur ? "#FF6B6B" : "#b8e0f8"}`, boxSizing:"border-box" }}
                    placeholder="Répétez le mot de passe"/>
                  <button type="button" onClick={()=>setVoirResetMdp(v=>!v)}
                    style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:17, color:"#6b7f8c", padding:4 }}
                    aria-label={voirResetMdp ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
                    {voirResetMdp ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
              {resetErreur && <div style={{ color:"#FF6B6B", fontSize:13, marginBottom:10 }}>❌ {resetErreur}</div>}
              <button onClick={validerNouveauMdp}
                style={{ width:"100%", padding:"13px", borderRadius:10, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:15, cursor:"pointer" }}>
                ✓ Enregistrer le nouveau mot de passe
              </button>
            </>)}

            {/* Étape 4 : succès */}
            {resetEtape === 4 && (<>
              <div style={{ textAlign:"center", padding:"16px 0" }}>
                <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
                <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:20, color:"#07a0f2", fontWeight:700, marginBottom:8 }}>Mot de passe modifié !</div>
                <div style={{ fontSize:14, color:"#6b7f8c", marginBottom:20 }}>Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.</div>
                <button onClick={()=>{
                    if (resetMode === "locataire") {
                      setAuthForm(f => ({ ...f, email: resetEmail, motdepasse: "" }));
                      setAuthMode("login");
                      setAuthErreur("");
                      setMode("auth");
                    } else if (resetMode === "proprio") {
                      setMode("loginProprio");
                    } else {
                      setMode("loginAdmin");
                    }
                  }}
                  style={{ width:"100%", padding:"13px", borderRadius:10, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:15, cursor:"pointer" }}>
                  → Se connecter
                </button>
              </div>
            </>)}

          </div>
          <button onClick={()=>setMode(resetMode === "locataire" ? "accueil" : resetMode === "proprio" ? "loginProprio" : "loginAdmin")}
            style={{ background:"transparent", color:"#07a0f2", border:"2px solid #07a0f2", borderRadius:10, padding:"11px 24px", fontSize:14, fontWeight:600, cursor:"pointer", width:"100%" }}>
            ← Retour
          </button>
        </div>
      </div>
    );
  }

  if (mode === "loginAdmin") return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#f8f9fa", minHeight:"100vh" }}>
      <div style={{ background:"#07a0f2", paddingBottom:0 }}>
        <div style={{ padding:"28px 16px 8px", textAlign:"center" }}>
          <div style={{ fontSize:32 }}>🔑</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:22, fontWeight:700, color:"#fff", marginTop:4 }}>Espace propriétaire</div>
          <div style={{ color:"#b8e8f0", fontSize:12, marginTop:2 }}>Accès réservé</div>
        </div>
        <Waves/>
      </div>
      <div style={{ padding:"24px 16px 32px" }}>
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"24px 20px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:19, color:"#07a0f2", fontWeight:700, marginBottom:16 }}>Connexion administrateur</div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Email</label>
            <input type="email" style={{ width:"100%", padding:"11px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }}
              value={authAdmin.email} onChange={e=>setAuthAdmin(a=>({...a,email:e.target.value}))}
              placeholder="votre@email.fr"/>
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Mot de passe</label>
            <div style={{ position:"relative" }}>
              <input type={showMdp.admin?"text":"password"} style={{ width:"100%", padding:"11px 42px 11px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }}
                value={authAdmin.password} onChange={e=>setAuthAdmin(a=>({...a,password:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&connecterAdmin()} placeholder="••••••••"/>
              <button type="button" onClick={()=>setShowMdp(p=>({...p,admin:!p.admin}))} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:18, color:"#6b7f8c" }}>{showMdp.admin?"🙈":"👁️"}</button>
            </div>
          </div>
          {erreurAdmin && (
            <div style={{ background:"#fff0f0", border:"1px solid #FF6B6B", borderRadius:8, padding:"10px 12px", color:"#c0302a", fontSize:13, marginBottom:12 }}>
              ❌ {erreurAdmin}
            </div>
          )}
          {estBloque("admin") && (
            <div style={{ background:"#fff3cd", border:"1px solid #f0c040", borderRadius:8, padding:"10px 12px", fontSize:13, color:"#a06000", marginBottom:12 }}>
              🔒 Compte bloqué encore {tempsRestant("admin")} min. Réinitialisez votre mot de passe.
            </div>
          )}
          <button style={{ background:"#07a0f2", color:"#fff", border:"none", borderRadius:10, padding:"13px 24px", fontSize:15, fontWeight:700, cursor:"pointer", width:"100%", marginBottom:10, opacity: estBloque("admin") ? 0.4 : 1 }}
            onClick={connecterAdmin} disabled={estBloque("admin")}>
            Se connecter
          </button>
          <button onClick={()=>ouvrirReset("admin")}
            style={{ background:"none", border:"none", color:"#6b7f8c", fontSize:13, cursor:"pointer", textDecoration:"underline", width:"100%", marginBottom:4 }}>
            Mot de passe oublié ?
          </button>
        </div>
        <button style={{ background:"transparent", color:"#07a0f2", border:"2px solid #07a0f2", borderRadius:10, padding:"11px 24px", fontSize:14, fontWeight:600, cursor:"pointer", width:"100%" }}
          onClick={()=>setMode("accueil")}>← Accueil</button>
      </div>
    </div>
  );

  // ── PAGE LOGIN PROPRIÉTAIRE ──────────────────────────────────────────────────
  if (mode === "loginProprio") return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#f8f9fa", minHeight:"100vh" }}>
      <div style={{ background:"#07a0f2", paddingBottom:0 }}>
        <div style={{ padding:"28px 16px 8px", textAlign:"center" }}>
          <div style={{ fontSize:32 }}>🏊</div>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:22, fontWeight:700, color:"#fff", marginTop:4 }}>Espace propriétaire</div>
          <div style={{ color:"#b8e8f0", fontSize:12, marginTop:2 }}>Gérez votre annonce et vos réservations</div>
        </div>
        <Waves/>
      </div>
      <div style={{ padding:"24px 16px 32px" }}>
        <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"24px 20px", marginBottom:14 }}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:19, color:"#07a0f2", fontWeight:700, marginBottom:16 }}>Connexion propriétaire</div>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Email</label>
            <input type="email" style={{ width:"100%", padding:"11px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }}
              value={authProprio.email} onChange={e=>setAuthProprio(a=>({...a,email:e.target.value}))}
              placeholder="votre@email.fr"/>
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:4, display:"block" }}>Mot de passe</label>
            <div style={{ position:"relative" }}>
              <input type={showMdp.proprio?"text":"password"} style={{ width:"100%", padding:"11px 42px 11px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box" }}
                value={authProprio.password} onChange={e=>setAuthProprio(a=>({...a,password:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&connecterProprio()} placeholder="••••••••"/>
              <button type="button" onClick={()=>setShowMdp(p=>({...p,proprio:!p.proprio}))} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:18, color:"#6b7f8c" }}>{showMdp.proprio?"🙈":"👁️"}</button>
            </div>
          </div>
          {erreurProprio && (
            <div style={{ background:"#fff0f0", border:"1px solid #FF6B6B", borderRadius:8, padding:"10px 12px", color:"#c0302a", fontSize:13, marginBottom:12 }}>
              ❌ {erreurProprio}
            </div>
          )}
          {estBloque("proprio") && (
            <div style={{ background:"#fff3cd", border:"1px solid #f0c040", borderRadius:8, padding:"10px 12px", fontSize:13, color:"#a06000", marginBottom:12 }}>
              🔒 Compte bloqué encore {tempsRestant("proprio")} min. Réinitialisez votre mot de passe.
            </div>
          )}
          <button style={{ background:"#07a0f2", color:"#fff", border:"none", borderRadius:10, padding:"13px 24px", fontSize:15, fontWeight:700, cursor:"pointer", width:"100%", marginBottom:10, opacity: estBloque("proprio") ? 0.4 : 1 }}
            onClick={connecterProprio} disabled={estBloque("proprio")}>
            Se connecter
          </button>
          <button onClick={()=>ouvrirReset("proprio")}
            style={{ background:"none", border:"none", color:"#6b7f8c", fontSize:13, cursor:"pointer", textDecoration:"underline", width:"100%", marginBottom:4 }}>
            Mot de passe oublié ?
          </button>
        </div>
        <button style={{ background:"transparent", color:"#07a0f2", border:"2px solid #07a0f2", borderRadius:10, padding:"11px 24px", fontSize:14, fontWeight:600, cursor:"pointer", width:"100%" }}
          onClick={()=>setMode("accueil")}>← Accueil</button>
      </div>
    </div>
  );

  // ── PAGE MAINTENANCE (vue locataires) ─────────────────────────────────────
  if (modeMainenance && !adminConnecte && !proprioConnecte && mode !== "loginAdmin" && mode !== "loginProprio") return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#f8f9fa", minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"32px 24px" }}>
      <div style={{ textAlign:"center", maxWidth:360 }}>
        <div style={{ fontSize:64, marginBottom:16 }}>🔧</div>
        <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:24, fontWeight:700, color:"#07a0f2", marginBottom:12 }}>
          Maintenance en cours
        </div>
        <div style={{ fontSize:15, color:"#6b7f8c", lineHeight:1.7, marginBottom:28, background:"#fff", borderRadius:14, padding:"16px 20px", boxShadow:"0 4px 20px rgba(0,0,0,.05)" }}>
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
    const ongletStyle = o => ({ flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: ongletPropri === o ? "#07a0f2" : "#e8f4f7", color: ongletPropri === o ? "#fff" : "#07a0f2" });
    return (
      <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
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

          {ongletPropri === "maintenance" && adminConnecte && (
            <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"20px 16px", marginBottom:14 }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#07a0f2", marginBottom:6, fontWeight:700 }}>🔧 Gestion de la maintenance</div>
              <div style={{ fontSize:13, color:"#6b7f8c", marginBottom:18, lineHeight:1.5 }}>
                Activez le mode maintenance pour afficher un message aux locataires pendant une intervention. Vous gardez l'accès à l'espace propriétaire.
              </div>

              {/* Toggle maintenance */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background: modeMainenance ? "#fff3f3" : "#e8f6fe", borderRadius:12, padding:"16px", border:`2px solid ${modeMainenance?"#FF6B6B":"#39b8f5"}`, marginBottom:16 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:15, color: modeMainenance?"#c0302a":"#07a0f2" }}>
                    {modeMainenance ? "🔴 Mode maintenance ACTIF" : "🟢 Application opérationnelle"}
                  </div>
                  <div style={{ fontSize:12, color:"#6b7f8c", marginTop:3 }}>
                    {modeMainenance ? "Les locataires voient la page de maintenance" : "Les locataires accèdent normalement à l'appli"}
                  </div>
                </div>
                <div onClick={() => setModeMaintenance(m => !m)}
                  style={{ width:52, height:30, borderRadius:15, background: modeMainenance?"#FF6B6B":"#39b8f5", cursor:"pointer", position:"relative", transition:"background .3s", flexShrink:0, marginLeft:12 }}>
                  <div style={{ position:"absolute", top:3, left: modeMainenance?25:3, width:24, height:24, borderRadius:"50%", background:"#fff", transition:"left .3s", boxShadow:"0 1px 4px rgba(0,0,0,.25)" }}/>
                </div>
              </div>

              {/* Message personnalisé */}
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:13, fontWeight:600, color:"#07a0f2", marginBottom:6, display:"block" }}>Message affiché aux locataires</label>
                <textarea value={messageMainenance} onChange={e => setMessageMaintenance(e.target.value)}
                  style={{ width:"100%", padding:"11px 12px", borderRadius:8, fontSize:13, border:"1.5px solid #b8e0f8", outline:"none", background:"#fff", boxSizing:"border-box", height:100, resize:"vertical", lineHeight:1.6 }}/>
              </div>

              {/* Aperçu */}
              <div style={{ background:"#f8f9fa", borderRadius:12, padding:"16px", border:"1px solid #e0d4c0" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#6b7f8c", marginBottom:10, textTransform:"uppercase", letterSpacing:.5 }}>Aperçu — Ce que voient les locataires</div>
                <div style={{ textAlign:"center", padding:"16px 12px" }}>
                  <div style={{ fontSize:40, marginBottom:8 }}>🔧</div>
                  <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:17, fontWeight:700, color:"#07a0f2", marginBottom:8 }}>Maintenance en cours</div>
                  <div style={{ fontSize:13, color:"#6b7f8c", lineHeight:1.6, background:"#fff", borderRadius:10, padding:"12px 14px" }}>{messageMainenance}</div>
                  <div style={{ fontSize:11, color:"#aaa", marginTop:10 }}>Merci de votre patience 🙏</div>
                </div>
              </div>

              {/* Messages rapides */}
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:12, fontWeight:600, color:"#6b7f8c", marginBottom:8 }}>Messages rapides :</div>
                {[
                  "🔧 L'application est momentanément en maintenance. Nous revenons très bientôt !",
                  "🏊 La piscine est fermée pour entretien. Réouverture prochainement.",
                  "❄️ Fermeture hivernale. La piscine rouvre au printemps. À bientôt !",
                  "🌊 Traitement de l'eau en cours. Réouverture dans quelques heures.",
                ].map((msg, i) => (
                  <button key={i} onClick={() => setMessageMaintenance(msg)}
                    style={{ width:"100%", textAlign:"left", padding:"9px 12px", borderRadius:8, background: messageMainenance===msg?"#e8f6fe":"#f5f5f5", border:`1.5px solid ${messageMainenance===msg?"#39b8f5":"#e0e0e0"}`, fontSize:12, color:"#2C3E50", cursor:"pointer", marginBottom:6, lineHeight:1.4 }}>
                    {msg}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Zone de réinitialisation des données de test — admin uniquement */}
          {ongletPropri === "maintenance" && adminConnecte && (
            <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"20px 16px", marginBottom:14, border:"2px solid #FF6B6B" }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#c0302a", marginBottom:6, fontWeight:700 }}>🗑 Réinitialiser les données de test</div>
              <div style={{ fontSize:13, color:"#6b7f8c", lineHeight:1.5, marginBottom:10 }}>
                Supprime définitivement <strong>toutes les réservations</strong>, les <strong>notes locataires</strong> et les <strong>codes promo</strong>. Les statistiques repartiront de zéro.
              </div>
              <div style={{ fontSize:12, color:"#2C3E50", background:"#f0f9ff", borderRadius:8, padding:"8px 12px", marginBottom:12, lineHeight:1.5 }}>
                ✅ Conservés : annonce, disponibilités, extras, éléments d'état des lieux, comptes locataires, réglages.
              </div>
              {suppressionResultat === "ok" && (
                <div style={{ background:"#e8f6fe", border:"1.5px solid #39b8f5", borderRadius:8, padding:"10px 12px", fontSize:13, color:"#07a0f2", fontWeight:600, marginBottom:12 }}>
                  ✅ Données de test supprimées. Les statistiques sont remises à zéro.
                </div>
              )}
              {suppressionResultat === "erreur" && (
                <div style={{ background:"#ffd6d6", border:"1.5px solid #c0302a", borderRadius:8, padding:"10px 12px", fontSize:13, color:"#c0302a", fontWeight:600, marginBottom:12 }}>
                  ❌ Une erreur est survenue pendant la suppression. Certaines données ont pu ne pas être effacées — vérifiez la console et réessayez.
                </div>
              )}
              <label style={{ fontSize:13, fontWeight:600, color:"#c0302a", marginBottom:4, display:"block" }}>
                Pour confirmer, tapez SUPPRIMER :
              </label>
              <input
                value={confirmSuppression}
                onChange={e => setConfirmSuppression(e.target.value)}
                placeholder="SUPPRIMER"
                style={{ width:"100%", padding:"10px 12px", borderRadius:8, fontSize:15, border:"1.5px solid #FF6B6B", outline:"none", background:"#fff", boxSizing:"border-box", marginBottom:10 }}
              />
              <button
                onClick={reinitialiserDonneesTest}
                disabled={confirmSuppression !== "SUPPRIMER" || suppressionEnCours}
                style={{
                  width:"100%", padding:"13px 24px", borderRadius:10, fontSize:15, fontWeight:700, border:"none",
                  background: confirmSuppression === "SUPPRIMER" && !suppressionEnCours ? "#c0302a" : "#e0e0e0",
                  color: confirmSuppression === "SUPPRIMER" && !suppressionEnCours ? "#fff" : "#aaa",
                  cursor: confirmSuppression === "SUPPRIMER" && !suppressionEnCours ? "pointer" : "not-allowed",
                }}>
                {suppressionEnCours ? "Suppression en cours…" : "🗑 Supprimer définitivement les données de test"}
              </button>
            </div>
          )}

          {ongletPropri === "dispo" && (
            <div style={card}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}><div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 18, color: "#07a0f2", fontWeight: 700 }}>🗓 Disponibilités</div>
                {/* Indicateur d'état réel : reflète le résultat de l'écriture en base,
                    et non une simple promesse d'enregistrement automatique. */}
                <span aria-live="polite" style={{ fontSize:11, borderRadius:20, padding:"3px 10px", fontWeight:600,
                  color: dispoStatut==="erreur" ? "#c0302a" : dispoStatut==="encours" ? "#a06000" : "#1a9850",
                  background: dispoStatut==="erreur" ? "#fff0f0" : dispoStatut==="encours" ? "#fff8e1" : "#e8faf0" }}>
                  {dispoStatut==="encours" ? "⏳ Enregistrement…" : dispoStatut==="erreur" ? "⚠️ Non enregistré" : dispoStatut==="ok" ? "✓ Enregistré" : "✓ Enregistrement automatique"}
                </span></div>

              {/* Sélecteur de date */}
              <label style={lbl}>Date</label>
              <input type="date" min={today()} value={propriDate} onChange={e => setPropriDate(e.target.value)} style={{ ...inp, marginBottom: 14 }} />

              {/* Boutons rapides */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7f8c", marginBottom: 8 }}>Actions rapides pour cette date</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => toutOuvrir(propriDate)} style={{ flex:1, padding:"9px 0", borderRadius:9, background:"#39b8f5", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    ✓ Tout ouvrir
                  </button>
                  <button onClick={() => toutFermer(propriDate)} style={{ flex:1, padding:"9px 0", borderRadius:9, background:"#FF6B6B", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    ✗ Tout fermer
                  </button>
                </div>
              </div>

              {/* Plage horaire rapide */}
              <div style={{ background:"#f0f9ff", borderRadius:10, padding:"12px", border:"1px solid #b8e0f8", marginBottom:14 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#07a0f2", marginBottom:10 }}>⏱ Ouvrir / Fermer une plage</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                  <div>
                    <label style={lbl}>De</label>
                    <select value={propriDebut} onChange={e => setPropriDebut(+e.target.value)} style={inp}>
                      {ALL_SLOTS.map(h => <option key={h} value={h}>{padH(h)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>À</label>
                    <select value={propriFin} onChange={e => setProprieFin(+e.target.value)} style={inp}>
                      {[...ALL_SLOTS.filter(h=>h>propriDebut),24].map(h => <option key={h} value={h}>{padH(h)}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => ouvrirPlage(propriDate, propriDebut, propriFin)} style={{ flex:1, padding:"9px 0", borderRadius:9, background:"#39b8f5", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
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
                  <button onClick={() => ouvrirPeriode(periodeDebut, periodeFin)} style={{ flex:1, padding:"9px 0", borderRadius:9, background:"#39b8f5", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
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
              <div style={{ fontSize:13, color:"#6b7f8c", marginBottom:10, lineHeight:1.5 }}>
                Appuyez sur un créneau pour l'<strong style={{color:"#39b8f5"}}>ouvrir</strong> ou le <strong style={{color:"#FF6B6B"}}>fermer</strong> individuellement.
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
                {ALL_SLOTS.map(h => {
                  const res = reservations.find(r => r.date === propriDate && r.paiement?.statut === "paye" && parseFloat(r.heureDebut) <= h && parseFloat(r.heureFin) > h);
                  // Informatif uniquement (n'empêche pas d'ouvrir/fermer) : une demande acceptée mais pas encore payée sur ce créneau
                  const enAttentePaiement = !res && reservations.find(r => r.date === propriDate && r.statut === "acceptee" && r.paiement?.statut !== "paye" && parseFloat(r.heureDebut) <= h && parseFloat(r.heureFin) > h);
                  const blocked = blockedH.has(h) && !res;
                  const dispo = estOuvert(propriDate, h);
                  const isSoir = h >= 20;
                  let bg, color, border, labelH, cliquable = false;
                  // 💰 = réservation payée (argent encaissé) — bien distinct des
                  // créneaux simplement fermés par la propriétaire (—) ou des tampons (🔒)
                  if (res) { bg="#07a0f2"; color="#fff"; border="2px solid #07a0f2"; labelH="💰 Payé"; }
                  else if (blocked) { bg="#ffe8b0"; color="#a06000"; border="2px solid #f0c040"; labelH="🔒 Tampon"; }
                  else if (dispo) { bg=isSoir?"#0480c4":"#39b8f5"; color="#fff"; border=`2px solid ${isSoir?"#0480c4":"#39b8f5"}`; labelH=isSoir?"✓🌙":"✓"; cliquable=true; }
                  else { bg="#f5f5f5"; color="#bbb"; border="2px dashed #ddd"; labelH="—"; cliquable=true; }
                  return (
                    <div key={h} onClick={() => cliquable && toggleCreneauProprio(h)}
                      style={{ borderRadius:10, padding:"8px 3px", fontSize:10, fontWeight:700, background:bg, color, border, cursor:cliquable?"pointer":"not-allowed", minWidth:60, textAlign:"center", transition:"all .15s", position:"relative" }}>
                      {padH(h)}<span style={{ fontWeight:400, opacity:.75 }}>→{padH(h + PAS)}</span><br/>
                      <span style={{ fontSize:9, fontWeight:400 }}>{labelH}</span>
                      {isSoir && !res && <div style={{ fontSize:8, opacity:.8, marginTop:1 }}>+1€/h</div>}
                      {enAttentePaiement && <div title="Accepté, en attente de paiement" style={{ position:"absolute", top:-4, right:-4, fontSize:11 }}>⏳</div>}
                    </div>
                  );
                })}
              </div>

              {/* Résumé plages */}
              {(disponibilites[propriDate]||[]).length > 0 ? (
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:"#07a0f2", marginBottom:6 }}>Plages ouvertes :</div>
                  {(disponibilites[propriDate]||[]).map((p,i) => (
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#e8f6fe", borderRadius:8, padding:"7px 12px", marginBottom:5 }}>
                      <span style={{ fontWeight:600, color:"#07a0f2", fontSize:13 }}>{padH(p.debut)} → {padH(p.fin)}</span>
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
                {[["#39b8f5","Ouvert"],["#0480c4","Ouvert soirée (+1€)"],["#07a0f2","💰 Réservé & payé"],["#ffe8b0","Tampon"],["#f5f5f5","Fermé par moi"]].map(([bg,label])=>(
                  <div key={label} style={{display:"flex",alignItems:"center",gap:3,fontSize:10}}>
                    <div style={{width:11,height:11,borderRadius:3,background:bg,border:"1px solid #ccc"}}/>
                    <span style={{color:"#6b7f8c"}}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ongletPropri === "extras" && (
            <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"20px 16px", marginBottom:14 }}>
              <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#07a0f2", marginBottom:4, fontWeight:700 }}>🖼️ Banque d'images</div>
              <div style={{ fontSize:12, color:"#6b7f8c", marginBottom:12, lineHeight:1.5 }}>
                Ajoute des photos une fois, réutilise-les ensuite sur n'importe quel extra.
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:12 }}>
                {banqueImages.map(img => (
                  <div key={img.id} style={{ position:"relative", width:72 }}>
                    <img src={img.url} alt={img.nom} style={{ width:72, height:72, borderRadius:10, objectFit:"cover", border:"1.5px solid #b8e0f8" }} />
                    <div style={{ fontSize:9, color:"#6b7f8c", textAlign:"center", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{img.nom}</div>
                    <button onClick={()=>{ if (window.confirm(`Supprimer l'image "${img.nom}" de la banque ? Les extras qui l'utilisent garderont leur photo actuelle, mais tu ne pourras plus la choisir pour de nouveaux extras.`)) { supprimerImageBanque(img.id); setBanqueImages(prev=>prev.filter(i=>i.id!==img.id)); } }}
                      style={{ position:"absolute", top:-6, right:-6, width:20, height:20, borderRadius:"50%", background:"#fff", border:"1.5px solid #FF6B6B", color:"#FF6B6B", fontSize:11, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>✕</button>
                  </div>
                ))}
                {banqueImages.length === 0 && <div style={{ fontSize:12, color:"#bbb" }}>Aucune image pour l'instant.</div>}
              </div>
              <label style={{ display:"inline-block", padding:"9px 16px", borderRadius:9, background:"#07a0f2", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                📤 Ajouter une image
                <input type="file" accept="image/*" style={{ display:"none" }} onChange={e => {
                  const file = e.target.files[0];
                  if (!file) return;
                  compresserImage(file)
                    .then(url => setNouvelleImageBanque({ url, nom: file.name.replace(/\.[^.]+$/, "") }))
                    .catch(() => alert("Cette image n'a pas pu être traitée."));
                  e.target.value = "";
                }} />
              </label>
              {nouvelleImageBanque && (
                <div style={{ marginTop:10, background:"#f0f9ff", borderRadius:10, padding:12, border:"1px solid #b8e0f8" }}>
                  <img src={nouvelleImageBanque.url} alt="" style={{ width:80, height:80, borderRadius:8, objectFit:"cover", marginBottom:8 }} />
                  <input value={nouvelleImageBanque.nom} onChange={e=>setNouvelleImageBanque(prev=>({...prev, nom:e.target.value}))}
                    placeholder="Nom de l'image" style={{ width:"100%", padding:"8px 10px", borderRadius:7, border:"1.5px solid #b8e0f8", fontSize:13, boxSizing:"border-box", marginBottom:8 }} />
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>{
                        const id = "img_"+Date.now();
                        sauvegarderImageBanque(id, nouvelleImageBanque.nom || "Sans nom", nouvelleImageBanque.url);
                        setBanqueImages(prev=>[{ id, nom: nouvelleImageBanque.nom || "Sans nom", url: nouvelleImageBanque.url }, ...prev]);
                        setNouvelleImageBanque(null);
                      }} style={{ flex:1, padding:"8px", borderRadius:7, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>✓ Enregistrer</button>
                    <button onClick={()=>setNouvelleImageBanque(null)} style={{ padding:"8px 14px", borderRadius:7, background:"transparent", color:"#6b7f8c", border:"1.5px solid #ddd", fontWeight:600, fontSize:13, cursor:"pointer" }}>Annuler</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {ongletPropri === "extras" && (
            <div style={{ background:"#fff", borderRadius:16, boxShadow:"0 4px 24px rgba(0,0,0,.06)", padding:"20px 16px", marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}><div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, color:"#07a0f2", fontWeight:700 }}>🎁 Gérer les extras</div><span style={{ fontSize:11, color:"#1a9850", background:"#e8faf0", borderRadius:20, padding:"3px 10px", fontWeight:600 }}>✓ Enregistrement automatique</span></div>

              {extras.map((e, i) => (
                <div key={e.id} style={{ background:"#f0f9ff", borderRadius:12, padding:"12px 14px", marginBottom:10, border:"1px solid #b8e0f8" }}>
                  {extraEnEdition === e.id ? (
                    /* Mode édition */
                    <div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                        <div>
                          <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Emoji</label>
                          <div style={{ display:"flex", gap:6 }}>
                            <input style={{ flex:1, padding:"8px", borderRadius:7, fontSize:18, border:"1.5px solid #b8e0f8", textAlign:"center", boxSizing:"border-box" }} value={e.emoji}
                              onChange={ev=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,emoji:ev.target.value}:x))} maxLength={2}/>
                            <button type="button" onClick={()=>setChoixEmojiExtraId(choixEmojiExtraId===e.id?null:e.id)} style={{ padding:"0 10px", borderRadius:7, border:"1.5px solid #b8e0f8", background:"#f0f9ff", cursor:"pointer", fontSize:14 }}>😀</button>
                          </div>
                          {choixEmojiExtraId === e.id && <SelecteurEmoji onChoisir={em=>{ setExtras(prev=>prev.map((x,j)=>j===i?{...x,emoji:em}:x)); setChoixEmojiExtraId(null); }} />}
                        </div>
                        <div>
                          <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Nom</label>
                          <input style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b8e0f8", boxSizing:"border-box" }} value={e.nom}
                            onChange={ev=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,nom:ev.target.value}:x))}/>
                        </div>
                      </div>
                      <div style={{ marginBottom:8 }}>
                        <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Description</label>
                        <textarea style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:12, border:"1.5px solid #b8e0f8", boxSizing:"border-box", height:60, resize:"vertical" }} value={e.description}
                          onChange={ev=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,description:ev.target.value}:x))}/>
                      </div>
                      <div style={{ marginBottom:8 }}>
                        <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Image (optionnel, remplace l'emoji)</label>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          {e.image ? (
                            <img src={e.image} alt="" style={{ width:44, height:44, borderRadius:8, objectFit:"cover" }} />
                          ) : (
                            <div style={{ width:44, height:44, borderRadius:8, background:"#fff", border:"1.5px dashed #b8e0f8", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{e.emoji}</div>
                          )}
                          <button onClick={()=>setChoixImageExtraId(choixImageExtraId===e.id?null:e.id)} style={{ padding:"7px 12px", borderRadius:7, background:"#e8f6fe", color:"#07a0f2", border:"1.5px solid #39b8f5", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                            🖼️ Choisir dans la banque
                          </button>
                          {e.image && (
                            <button onClick={()=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,image:null}:x))} style={{ padding:"7px 12px", borderRadius:7, background:"transparent", color:"#FF6B6B", border:"1.5px solid #FF6B6B", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                            Retirer
                          </button>
                          )}
                        </div>
                        {choixImageExtraId === e.id && (
                          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:10, background:"#fff", borderRadius:8, padding:10, border:"1px solid #e0e0e0" }}>
                            {banqueImages.length === 0 && <div style={{ fontSize:12, color:"#bbb" }}>Banque vide — ajoute des images dans la carte ci-dessus.</div>}
                            {banqueImages.map(img => (
                              <img key={img.id} src={img.url} alt={img.nom} title={img.nom} onClick={()=>{ setExtras(prev=>prev.map((x,j)=>j===i?{...x,image:img.url}:x)); setChoixImageExtraId(null); }}
                                style={{ width:52, height:52, borderRadius:7, objectFit:"cover", cursor:"pointer", border: e.image===img.url ? "2px solid #07a0f2" : "1.5px solid #ddd" }} />
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
                        <div>
                          <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Tarif (€)</label>
                          <input type="number" min={0} style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b8e0f8", boxSizing:"border-box" }} value={e.tarif}
                            onChange={ev=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,tarif:+ev.target.value}:x))}/>
                        </div>
                        <div>
                          <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Type</label>
                          <select style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b8e0f8", boxSizing:"border-box" }} value={e.type}
                            onChange={ev=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,type:ev.target.value}:x))}>
                            <option value="forfait">Forfait location</option>
                            <option value="personne">Par personne</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={()=>setExtraEnEdition(null)} style={{ flex:1, padding:"8px", borderRadius:8, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>✓ Valider</button>
                        <button onClick={()=>{ if (window.confirm(`Supprimer définitivement l'extra "${e.nom}" ? Cette action est immédiate et irréversible.`)) { supprimerExtra(e.id); setExtras(prev=>prev.filter((_,j)=>j!==i)); setExtraEnEdition(null); } }} style={{ padding:"8px 14px", borderRadius:8, background:"#fff0f0", color:"#FF6B6B", border:"1.5px solid #FF6B6B", fontWeight:700, fontSize:13, cursor:"pointer" }}>🗑 Supprimer</button>
                      </div>
                    </div>
                  ) : (
                    /* Mode affichage */
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      {e.image ? <img src={e.image} alt="" style={{ width:36, height:36, borderRadius:8, objectFit:"cover", flexShrink:0 }} /> : <div style={{ fontSize:26, flexShrink:0 }}>{e.emoji}</div>}
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:14, color:"#2C3E50" }}>{e.nom}</div>
                        <div style={{ fontSize:11, color:"#6b7f8c", marginTop:1 }}>
                          {e.type==="personne"?`${e.tarif} €/pers`:`${e.tarif} € forfait`}
                        </div>
                        <div style={{ fontSize:11, color:"#aaa", marginTop:1, fontStyle:"italic" }}>{e.description}</div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6, alignItems:"center" }}>
                        {/* Toggle actif */}
                        <div onClick={()=>setExtras(prev=>prev.map((x,j)=>j===i?{...x,actif:!x.actif}:x))}
                          style={{ width:42, height:24, borderRadius:12, background:e.actif?"#39b8f5":"#ddd", cursor:"pointer", position:"relative", transition:"background .2s", flexShrink:0 }}>
                          <div style={{ position:"absolute", top:3, left:e.actif?21:3, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left .2s", boxShadow:"0 1px 3px rgba(0,0,0,.2)" }}/>
                        </div>
                        {/* Modifier */}
                        <button onClick={()=>setExtraEnEdition(e.id)} style={{ width:30, height:30, borderRadius:7, border:"1.5px solid #07a0f2", background:"#e8f4f7", color:"#07a0f2", cursor:"pointer", fontSize:14, fontWeight:700 }}>✏️</button>
                        {/* Supprimer direct */}
                        <button onClick={()=>{ if (window.confirm(`Supprimer définitivement l'extra "${e.nom}" ? Cette action est immédiate et irréversible. Pour le désactiver temporairement sans le perdre, utilise plutôt l'interrupteur à gauche.`)) { supprimerExtra(e.id); setExtras(prev=>prev.filter((_,j)=>j!==i)); } }} style={{ width:30, height:30, borderRadius:7, border:"none", background:"#fff0f0", color:"#FF6B6B", cursor:"pointer", fontSize:14 }}aria-label={`Supprimer l'extra ${e.nom}`}>🗑</button>
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize:10, color:e.actif?"#39b8f5":"#aaa", fontWeight:600, marginTop:6 }}>
                    {e.actif?"✓ Visible":"✗ Masqué"}
                  </div>
                </div>
              ))}

              {/* Formulaire ajout */}
              {ajoutExtraMode ? (
                <div style={{ background:"#fff", borderRadius:12, padding:"14px", border:"2px solid #39b8f5", marginTop:8 }}>
                  <div style={{ fontWeight:700, color:"#07a0f2", fontSize:14, marginBottom:12 }}>Nouvel extra</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                    <div>
                      <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Emoji</label>
                      <div style={{ display:"flex", gap:6 }}>
                        <input style={{ flex:1, padding:"8px", borderRadius:7, fontSize:18, border:"1.5px solid #b8e0f8", textAlign:"center", boxSizing:"border-box" }} value={nouvelExtra.emoji}
                          onChange={e=>setNouvelExtra(p=>({...p,emoji:e.target.value}))} maxLength={2}/>
                        <button type="button" onClick={()=>setChoixEmojiExtraId(choixEmojiExtraId==="__nouveau__"?null:"__nouveau__")} style={{ padding:"0 10px", borderRadius:7, border:"1.5px solid #b8e0f8", background:"#f0f9ff", cursor:"pointer", fontSize:14 }}>😀</button>
                      </div>
                      {choixEmojiExtraId === "__nouveau__" && <SelecteurEmoji onChoisir={em=>{ setNouvelExtra(p=>({...p,emoji:em})); setChoixEmojiExtraId(null); }} />}
                    </div>
                    <div>
                      <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Nom</label>
                      <input style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b8e0f8", boxSizing:"border-box" }} value={nouvelExtra.nom} placeholder="Ex: Pétanque"
                        onChange={e=>setNouvelExtra(p=>({...p,nom:e.target.value}))}/>
                    </div>
                  </div>
                  <div style={{ marginBottom:8 }}>
                    <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Description</label>
                    <textarea style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:12, border:"1.5px solid #b8e0f8", boxSizing:"border-box", height:55, resize:"vertical" }} value={nouvelExtra.description}
                      placeholder="Ce qui est inclus..." onChange={e=>setNouvelExtra(p=>({...p,description:e.target.value}))}/>
                  </div>
                  <div style={{ marginBottom:8 }}>
                    <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Image (optionnel, remplace l'emoji)</label>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      {nouvelExtra.image ? (
                        <img src={nouvelExtra.image} alt="" style={{ width:44, height:44, borderRadius:8, objectFit:"cover" }} />
                      ) : (
                        <div style={{ width:44, height:44, borderRadius:8, background:"#f9f9f9", border:"1.5px dashed #b8e0f8", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{nouvelExtra.emoji}</div>
                      )}
                      <button onClick={()=>setChoixImageExtraId(choixImageExtraId==="__nouveau__"?null:"__nouveau__")} style={{ padding:"7px 12px", borderRadius:7, background:"#e8f6fe", color:"#07a0f2", border:"1.5px solid #39b8f5", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                        🖼️ Choisir dans la banque
                      </button>
                      {nouvelExtra.image && (
                        <button onClick={()=>setNouvelExtra(p=>({...p,image:null}))} style={{ padding:"7px 12px", borderRadius:7, background:"transparent", color:"#FF6B6B", border:"1.5px solid #FF6B6B", fontWeight:600, fontSize:12, cursor:"pointer" }}>Retirer</button>
                      )}
                    </div>
                    {choixImageExtraId === "__nouveau__" && (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:10, background:"#f9f9f9", borderRadius:8, padding:10, border:"1px solid #e0e0e0" }}>
                        {banqueImages.length === 0 && <div style={{ fontSize:12, color:"#bbb" }}>Banque vide — ajoute des images dans la carte ci-dessus.</div>}
                        {banqueImages.map(img => (
                          <img key={img.id} src={img.url} alt={img.nom} title={img.nom} onClick={()=>{ setNouvelExtra(p=>({...p,image:img.url})); setChoixImageExtraId(null); }}
                            style={{ width:52, height:52, borderRadius:7, objectFit:"cover", cursor:"pointer", border: nouvelExtra.image===img.url ? "2px solid #07a0f2" : "1.5px solid #ddd" }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
                    <div>
                      <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Tarif (€)</label>
                      <input type="number" min={0} style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b8e0f8", boxSizing:"border-box" }} value={nouvelExtra.tarif}
                        onChange={e=>setNouvelExtra(p=>({...p,tarif:+e.target.value}))}/>
                    </div>
                    <div>
                      <label style={{ fontSize:12, fontWeight:600, color:"#07a0f2", marginBottom:3, display:"block" }}>Type</label>
                      <select style={{ width:"100%", padding:"8px", borderRadius:7, fontSize:13, border:"1.5px solid #b8e0f8", boxSizing:"border-box" }} value={nouvelExtra.type}
                        onChange={e=>setNouvelExtra(p=>({...p,type:e.target.value}))}>
                        <option value="forfait">Forfait location</option>
                        <option value="personne">Par personne</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button style={{ flex:1, padding:"9px", borderRadius:9, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:14, cursor:"pointer" }} onClick={()=>{
                      if(!nouvelExtra.nom) return;
                      setExtras(prev=>[...prev,{...nouvelExtra,id:"e"+Date.now()}]);
                      setNouvelExtra({nom:"",description:"",tarif:0,type:"forfait",emoji:"✨",image:null,actif:true});
                      setAjoutExtraMode(false);
                    }}>Ajouter</button>
                    <button style={{ padding:"9px 16px", borderRadius:9, background:"transparent", color:"#07a0f2", border:"2px solid #07a0f2", fontWeight:700, fontSize:14, cursor:"pointer" }} onClick={()=>setAjoutExtraMode(false)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <button style={{ width:"100%", padding:"11px", borderRadius:9, background:"#39b8f5", color:"#fff", border:"none", fontWeight:700, fontSize:14, cursor:"pointer", marginTop:8 }} onClick={()=>setAjoutExtraMode(true)}>
                  ➕ Ajouter un extra
                </button>
              )}
            </div>
          )}

                    {ongletPropri === "inventaire" && (
            <div style={card}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}><div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 18, color: "#07a0f2", fontWeight: 700 }}>🛋️ État des lieux</div><span style={{ fontSize:11, color:"#1a9850", background:"#e8faf0", borderRadius:20, padding:"3px 10px", fontWeight:600 }}>✓ Enregistrement automatique</span></div>
              <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 14, lineHeight: 1.5 }}>
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
                    }} style={{ marginLeft: 8, width: 28, height: 28, borderRadius: 7, border: "none", background: "#fff0f0", color: "#FF6B6B", cursor: "pointer", fontSize: 13, flexShrink: 0 }} title="Retirer cet élément"aria-label={`Retirer ${item} de l'état des lieux`}>🗑</button>
                  </div>
                </div>
              ))}

              {/* Ajout d'un nouvel élément */}
              <div style={{ display: "flex", gap: 8, marginTop: 10, background: "#f0f9ff", borderRadius: 9, padding: "10px", border: "1.5px dashed #39b8f5" }}>
                <input value={nouvelElementEdl} onChange={e => setNouvelElementEdl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && nouvelElementEdl.trim() && (setElementsEdl(prev => [...prev, nouvelElementEdl.trim()]), setNouvelElementEdl(""))}
                  placeholder="Ex: Plongeoir, Coussin de sol..." style={{ flex: 1, padding: "8px 10px", borderRadius: 6, fontSize: 13, border: "1px solid #b8e0f8", boxSizing: "border-box" }} />
                <button onClick={() => { if (nouvelElementEdl.trim()) { setElementsEdl(prev => [...prev, nouvelElementEdl.trim()]); setNouvelElementEdl(""); } }}
                  style={{ padding: "8px 16px", borderRadius: 6, background: "#07a0f2", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>+ Ajouter</button>
              </div>

              <div style={{ background: "#e8f6fe", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#07a0f2", fontWeight: 600, marginTop: 12 }}>✓ {Object.values(inventaire).flat().length} photos enregistrées sur {elementsEdl.length} élément{elementsEdl.length > 1 ? "s" : ""}</div>
            </div>
          )}

          {ongletPropri === "reservations" && (() => {
            // ── Répartition des réservations par catégorie, façon Swimmy ──
            const aujourdhui = today();
            const categorie = r => {
              const st = r.statut || "acceptee"; // anciennes résas sans statut = acceptées
              if (st === "en_attente") return "attente";
              if (st === "refusee" || st === "annulee") return "autres";
              return r.date >= aujourdhui ? "avenir" : "passees";
            };
            const parCategorie = { attente: [], avenir: [], passees: [], autres: [] };
            reservations.forEach(r => parCategorie[categorie(r)].push(r));

            const onglets = [
              ["attente", "En attente", parCategorie.attente.length],
              ["avenir", "À venir", parCategorie.avenir.length],
              ["passees", "Passées", parCategorie.passees.length],
              ["autres", "Autres", parCategorie.autres.length],
            ];

            // Les passées et les annulées se lisent de la plus récente à la plus
            // ancienne ; les demandes en attente et les venues à venir dans l'ordre
            // chronologique, pour traiter d'abord ce qui arrive le plus tôt.
            const ordreDecroissant = filtreResas === "passees" || filtreResas === "autres";
            const liste = [...parCategorie[filtreResas]].sort((a, b) => {
              const cmpDate = a.date.localeCompare(b.date);
              if (cmpDate !== 0) return ordreDecroissant ? -cmpDate : cmpDate;
              return (a.heureDebut || 0) - (b.heureDebut || 0);
            });

            // Regroupement par date : une seule barre d'en-tête par journée
            const groupes = [];
            liste.forEach(r => {
              const dernier = groupes[groupes.length - 1];
              if (dernier && dernier[0] === r.date) dernier[1].push(r);
              else groupes.push([r.date, [r]]);
            });

            const dateLongue = iso => {
              const [a, m, j] = iso.split("-");
              return new Date(+a, +m - 1, +j).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
            };
            const messageVide = {
              attente: "Aucune demande en attente. 🎉",
              avenir: "Aucune réservation à venir pour le moment.",
              passees: "Aucune réservation passée.",
              autres: "Aucune réservation refusée ou annulée.",
            }[filtreResas];

            return (
            <div style={card}>
              <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 18, color: "#07a0f2", marginBottom: 12, fontWeight: 700 }}>📋 Réservations</div>

              {/* Filtres par catégorie, avec le nombre de réservations concernées */}
              <div role="tablist" aria-label="Filtrer les réservations" style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
                {onglets.map(([cle, libelle, nombre]) => {
                  const actif = filtreResas === cle;
                  const alerte = cle === "attente" && nombre > 0;
                  return (
                    <button key={cle} role="tab" aria-selected={actif} onClick={() => setFiltreResas(cle)}
                      style={{ padding: "7px 15px", borderRadius: 50, fontSize: 13, fontWeight: 700, cursor: "pointer",
                        border: `1.5px solid ${actif ? "#07a0f2" : alerte ? "#f0c040" : "#b8e0f8"}`,
                        background: actif ? "#07a0f2" : alerte ? "#fff8e1" : "#fff",
                        color: actif ? "#fff" : alerte ? "#a06000" : "#07a0f2" }}>
                      {alerte && !actif ? "🔔 " : ""}{libelle}
                      <span style={{ marginLeft: 6, fontSize: 11, opacity: actif ? 0.85 : 0.7 }}>({nombre})</span>
                    </button>
                  );
                })}
              </div>

              {groupes.length === 0 ? (
                <div style={{ color: "#6b7f8c", fontSize: 14, textAlign: "center", padding: "24px 0" }}>{messageVide}</div>
              ) : groupes.map(([dateGroupe, resasDuJour]) => (
                <div key={dateGroupe} style={{ marginBottom: 18 }}>
                  {/* Barre de date façon Swimmy */}
                  <div style={{ background: "#07a0f2", color: "#fff", borderRadius: 10, padding: "8px 14px", fontWeight: 800, fontSize: 14, marginBottom: 10 }}>
                    {dateLongue(dateGroupe)}
                  </div>
                  {resasDuJour.map(r => {
                const noteP = notesLocataires[r.ref];
                const sessionPassee = r.date <= today();
                const statut = r.statut || "acceptee"; // anciennes résas sans statut = acceptées par défaut
                const badgeStatut = {
                  en_attente: { bg:"#fff8e1", color:"#a06000", border:"#f0c040", label:"⏳ En attente" },
                  acceptee: { bg:"#e8f6fe", color:"#07a0f2", border:"#39b8f5", label:"✓ Acceptée" },
                  refusee: { bg:"#fff0f0", color:"#c0302a", border:"#FF6B6B", label:"✗ Refusée" },
                  annulee: { bg:"#f5f5f5", color:"#888", border:"#ccc", label:"🚫 Annulée" },
                }[statut];
                return (
                  <div key={r.ref} style={{ background: statut==="en_attente" ? "#fffdf5" : "#f0f9ff", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: statut==="en_attente" ? "2px solid #f0c040" : "1px solid #b8e0f8" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div style={{ fontWeight: 700, color: "#07a0f2", fontSize: 13 }}>{r.ref}</div>
                      <div style={{ display:"flex", gap:4, flexWrap:"wrap", justifyContent:"flex-end" }}>
                        {/* Badge paiement */}
                        {r.verificationCanal === "email" && (
                          <span title="Le code a été envoyé par email : le numéro de téléphone n'a pas été confirmé joignable." style={{ fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, background:"#fff8e1", color:"#a06000", border:"1px solid #f0c040" }}>
                            📧 Tél. non vérifié
                          </span>
                        )}
                        {r.note && (
                          <span title={r.commentaire || ""} style={{ fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, background:"#fff8e1", color:"#a06000", border:"1px solid #f0c040" }}>
                            {"⭐".repeat(r.note)} avis client
                          </span>
                        )}
                        {r.commentaire && (
                          <div style={{ width:"100%", fontSize:12, color:"#6b7f8c", fontStyle:"italic", background:"#f8f9fa", borderRadius:8, padding:"6px 10px", marginTop:4 }}>
                            💬 « {r.commentaire} »
                          </div>
                        )}
                        {r.paiement?.rembourse && (
                          <span style={{ fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, background:"#f0e6ff", color:"#6b3fa0", border:"1px solid #b088e0" }} title={r.paiement.dateRemboursement ? new Date(r.paiement.dateRemboursement).toLocaleDateString("fr-FR") : ""}>
                            ↩️ Remboursée {formatEur(r.paiement.montantRembourseStripe)}
                          </span>
                        )}
                        {r.paiement && (
                          r.paiement.statut === "paye"
                            ? <span style={{ fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, background:"#e8f6fe", color:"#07a0f2", border:"1px solid #39b8f5" }}>💳 Payée</span>
                          : (r.paiement.url && statut === "acceptee")
                            ? <span style={{ fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, background:"#fff8e1", color:"#a06000", border:"1px solid #f0c040" }}>💳 Lien envoyé, non payée</span>
                          : null
                        )}
                        <span style={{ fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, background:badgeStatut.bg, color:badgeStatut.color, border:`1px solid ${badgeStatut.border}` }}>
                          {badgeStatut.label}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: "#2C3E50", marginTop: 2 }}>{r.prenom} {r.nom} · {r.email}</div>
                    {comptes[r.email]?.ville && <div style={{ fontSize: 11, color: "#6b7f8c" }}>📍 {comptes[r.email]?.codePostal} {comptes[r.email]?.ville}</div>}
                    <div style={{ fontSize: 12, color: "#6b7f8c" }}>{r.date} · {padH(r.heureDebut ?? parseInt(r.heureDebut))} → {padH(r.heureFin ?? parseInt(r.heureFin))}</div>
                    <div style={{ fontSize: 12, color: "#6b7f8c" }}>{r.adultes} adulte{r.adultes > 1 ? "s" : ""}{r.enfants12 > 0 ? ` + ${r.enfants12} enfant` : ""} · {formatEur(r.prix)}</div>
                    {r.demandeISO && <div style={{ fontSize: 11, color: "#aabbc0", marginTop: 2 }}>
                      🕐 Demande reçue le {new Date(r.demandeISO).toLocaleDateString("fr-FR")} à {new Date(r.demandeISO).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </div>}
                    {/* ── État des lieux de sortie signé : récap + validation par la propriétaire ── */}
                    {r.edlSortie && !r.edlValideProprio && (
                      <div style={{ marginTop: 10, background: "#fff8e1", border: "2px solid #f0c040", borderRadius: 12, padding: "12px 14px" }}>
                        <div style={{ fontWeight: 700, color: "#a06000", fontSize: 13, marginBottom: 8 }}>📋 État des lieux de sortie à valider</div>
                        {(() => {
                          const anomalies = Object.entries(r.edlSortie.reponses || {}).filter(([, rep]) => !rep.present || !rep.fonctionnel);
                          return anomalies.length > 0 ? (
                            <div style={{ marginBottom: 8 }}>
                              {anomalies.map(([item, rep]) => (
                                <div key={item} style={{ fontSize: 12, color: "#c0302a", background: "#fff0f0", borderRadius: 7, padding: "5px 9px", marginBottom: 4 }}>
                                  ⚠️ {item} : {!rep.present ? "absent" : "présent"}{!rep.fonctionnel ? ", non fonctionnel" : ""}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: "#1a9850", marginBottom: 8 }}>✅ Tous les éléments indiqués présents et fonctionnels.</div>
                          );
                        })()}
                        {r.edlSortie.commentaire && <div style={{ fontSize: 12, color: "#6b7f8c", fontStyle: "italic", marginBottom: 8 }}>💬 « {r.edlSortie.commentaire} »</div>}
                        {r.descriptionCasse && <div style={{ fontSize: 12, color: "#c0302a", marginBottom: 8 }}><strong>Dégât signalé :</strong> {r.descriptionCasse}</div>}
                        {r.edlSortie.signature && (
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11, color: "#6b7f8c", marginBottom: 3 }}>Signature du locataire :</div>
                            <img src={r.edlSortie.signature} alt="Signature" style={{ height: 50, background: "#fff", borderRadius: 7, border: "1px solid #e0e0e0", padding: 4 }} />
                          </div>
                        )}
                        <button onClick={() => {
                          // Validation après le tour de la piscine — action explicite de la propriétaire
                          setReservations(prev => {
                            const next = prev.map(x => x.ref === r.ref ? { ...x, edlValideProprio: true, edlValideDate: new Date().toISOString() } : x);
                            const updated = next.find(x => x.ref === r.ref);
                            if (updated) sauvegarderReservation(updated);
                            return next;
                          });
                        }} style={{ width: "100%", padding: "9px", borderRadius: 8, background: "#2ecc71", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                          ✓ J'ai fait le tour, je valide l'état des lieux
                        </button>
                        <button onClick={() => imprimerEtatDesLieux(r)} style={{ width: "100%", marginTop: 6, padding: "8px", borderRadius: 8, background: "#fff", color: "#07a0f2", border: "1.5px solid #07a0f2", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                          📄 Récapitulatif PDF
                        </button>
                      </div>
                    )}
                    {r.edlValideProprio && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 12, color: "#1a9850", background: "#e8faf0", borderRadius: 8, padding: "6px 10px" }}>
                          ✅ État des lieux validé{r.edlValideDate ? ` le ${new Date(r.edlValideDate).toLocaleDateString("fr-FR")}` : ""}
                        </div>
                        <button onClick={() => imprimerEtatDesLieux(r)} style={{ width: "100%", marginTop: 6, padding: "8px", borderRadius: 8, background: "#fff", color: "#07a0f2", border: "1.5px solid #07a0f2", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                          📄 Récapitulatif PDF
                        </button>
                      </div>
                    )}
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
                          <button style={{ flex:1, padding:"10px", borderRadius:9, background:"#39b8f5", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}
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

                    {/* Annulation d'une réservation déjà acceptée — avec règles selon délai */}
                    {statut === "acceptee" && !sessionPassee && (() => {
                      const pen = calculerPenalite(r);
                      return annulEnCoursRef === r.ref ? (
                        <div style={{ marginTop:10, background:"#fff", borderRadius:10, padding:"12px", border:"1.5px solid #FF6B6B" }}>
                          <div style={{ fontWeight:700, color:"#c0302a", fontSize:13, marginBottom:6 }}>Annulation propriétaire</div>
                          {/* Règles de pénalité si le locataire a demandé l'annulation */}
                          <div style={{ background:"#fff8f8", borderRadius:8, padding:"8px 10px", marginBottom:10, fontSize:12, color:"#c0302a", lineHeight:1.6 }}>
                            <strong>Si annulation à votre initiative :</strong> remboursement intégral au locataire (aucune pénalité).<br/>
                            <strong>Si annulation demandée par le locataire :</strong> {pen.impossible ? "Session déjà commencée." : pen.label}.
                            {!pen.impossible && pen.taux > 0 && <> Retenu : <strong>{formatEur(pen.retenu)}</strong> · Remboursé : <strong>{formatEur(pen.rembourse)}</strong></>}
                          </div>
                          <label style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, cursor:"pointer" }}>
                            <input type="checkbox" checked={annulationParLocataireVal} onChange={e=>setAnnulationParLocataireVal(e.target.checked)} style={{ accentColor:"#07a0f2" }}/>
                            <span style={{ fontSize:12, color:"#2C3E50" }}>Le locataire m'a demandé d'annuler (pénalités ci-dessus s'appliquent)</span>
                          </label>
                          <textarea value={motifAnnulVal} onChange={e=>setMotifAnnulVal(e.target.value)} placeholder="Ex: force majeure, indisponibilité imprévue..."
                            style={{ ...inp, height:60, resize:"vertical", fontSize:12, marginBottom:8 }}/>
                          <div style={{ display:"flex", gap:8 }}>
                            <button style={{ flex:1, padding:"9px", borderRadius:8, background:"#FF6B6B", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}
                              onClick={async () => {
                                const montantRemb = annulationParLocataireVal && !pen.impossible ? pen.rembourse : (r.totalGeneral||r.prix);
                                const montantRet = annulationParLocataireVal && !pen.impossible ? pen.retenu : 0;
                                let updated = { ...r, statut:"annulee", motifAnnulation: motifAnnulVal||"", annulationParLocataire: annulationParLocataireVal, montantRetenu: montantRet, montantRembourse: montantRemb, penaliteTaux: annulationParLocataireVal && !pen.impossible ? pen.taux : 0 };
                                setReservations(prev => prev.map(x => x.ref===r.ref?updated:x));
                                sauvegarderReservation(updated);
                                // Remboursement automatique Stripe si déjà payée
                                if (r.paiement?.statut === "paye" && montantRemb > 0) {
                                  try {
                                    const rep = await fetch('/api/paiement', {
                                      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
                                      body: JSON.stringify({ action: 'rembourser', ref: r.ref, montant: montantRemb }),
                                    });
                                    if (rep.ok) {
                                      const d = await rep.json();
                                      updated = { ...updated, paiement: { ...updated.paiement, rembourse: true, montantRembourseStripe: d.montantRembourse } };
                                      setReservations(prev => prev.map(x => x.ref===r.ref?updated:x));
                                    } else {
                                      const err = await rep.json().catch(()=>({}));
                                      console.error('Remboursement automatique échoué:', err);
                                      alert(`Le remboursement automatique a échoué (${err.error || "erreur inconnue"}). À faire manuellement depuis Stripe.`);
                                    }
                                  } catch (e) {
                                    console.error('Erreur réseau remboursement:', e);
                                    alert("Erreur réseau lors du remboursement. À faire manuellement depuis Stripe si besoin.");
                                  }
                                }
                                envoyerEmailAnnulation(updated);
                                setAnnulEnCoursRef(null); setMotifAnnulVal(""); setAnnulationParLocataireVal(false);
                              }}>
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
                    })()}

                    {/* Remboursement commercial après la location */}
                    {sessionPassee && statut === "acceptee" && (
                      rembRef === r.ref ? (
                        <div style={{ marginTop:10, background:"#f0f9ff", borderRadius:10, padding:"12px", border:"1.5px solid #39b8f5" }}>
                          <div style={{ fontWeight:700, color:"#07a0f2", fontSize:13, marginBottom:6 }}>💸 Remboursement commercial</div>
                          <div style={{ fontSize:12, color:"#6b7f8c", marginBottom:10, lineHeight:1.6 }}>
                            Total payé : <strong>{formatEur(r.totalGeneral||r.prix)}</strong><br/>
                            Frais de gestion : <strong>25%</strong> du montant remboursé<br/>
                            {rembMontant && parseFloat(rembMontant) > 0 && (
                              <>Net versé au locataire : <strong style={{ color:"#07a0f2" }}>{formatEur(parseFloat(rembMontant)*0.75)}</strong> (frais : {formatEur(parseFloat(rembMontant)*0.25)})</>
                            )}
                          </div>
                          <label style={{ fontSize:12, color:"#6b7f8c", marginBottom:4, display:"block" }}>Montant à rembourser (avant frais)</label>
                          <input type="number" min="0" max={r.totalGeneral||r.prix} value={rembMontant} onChange={e=>setRembMontant(e.target.value)}
                            style={{ ...inp, marginBottom:10 }} placeholder="Ex: 20"/>
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={()=>appliquerRemboursement(r.ref)}
                              style={{ flex:1, padding:"9px", borderRadius:8, background:"#07a0f2", color:"#fff", border:"none", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                              ✓ Valider le remboursement
                            </button>
                            <button onClick={()=>{ setRembRef(null); setRembMontant(""); }}
                              style={{ ...btnS, marginTop:0, fontSize:13, padding:"9px" }}>Annuler</button>
                          </div>
                        </div>
                      ) : !r.remboursementCommercial ? (
                        <button onClick={()=>{ setRembRef(r.ref); setRembMontant(""); }}
                          style={{ marginTop:10, width:"100%", padding:"9px", borderRadius:8, background:"none", border:"1.5px solid #39b8f5", color:"#07a0f2", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                          💸 Effectuer un remboursement commercial
                        </button>
                      ) : (
                        <div style={{ marginTop:10, background:"#e8f6fe", borderRadius:8, padding:"8px 12px", fontSize:12, color:"#07a0f2" }}>
                          ✅ Remboursement de {formatEur(r.remboursementCommercial.montantDemande)} effectué
                          (net versé : {formatEur(r.remboursementCommercial.netRembourse)} · frais : {formatEur(r.remboursementCommercial.fraisGestion)})
                        </div>
                      )
                    )}
                    {noteP ? (
                      <div style={{ marginTop: 8, background: "#e8f6fe", borderRadius: 8, padding: "7px 10px" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#07a0f2" }}>Votre note : {"⭐".repeat(noteP.note)}{noteP.note >= 4 ? <span style={{ color: "#39b8f5", marginLeft: 6 }}>✓ Code accordé</span> : <span style={{ color: "#FF6B6B", marginLeft: 6 }}>✗ Code refusé</span>}</div>
                        {noteP.commentaire && <div style={{ fontSize: 11, color: "#6b7f8c" }}>"{noteP.commentaire}"</div>}
                      </div>
                    ) : sessionPassee && statut === "acceptee" && (
                      noteEnCoursRef === r.ref ? (
                        <div style={{ marginTop: 10, background: "#f0f9ff", borderRadius: 10, padding: "12px", border: "1px solid #b8e0f8" }}>
                          <div style={{ fontWeight: 700, color: "#07a0f2", fontSize: 13, marginBottom: 8 }}>⭐ Notez ce locataire</div>
                          <Stars value={noteProprioVal} onChange={setNoteProprioVal} />
                          {noteProprioVal > 0 && <div style={{ marginTop: 6, padding: "5px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: noteProprioVal >= 4 ? "#e8f6fe" : "#fff0f0", color: noteProprioVal >= 4 ? "#07a0f2" : "#FF6B6B", border: `1px solid ${noteProprioVal >= 4 ? "#39b8f5" : "#FF6B6B"}`, marginBottom: 8, textAlign: "center" }}>{noteProprioVal >= 4 ? `✓ Code promo accordé (${noteProprioVal === 5 ? "-10%" : "-5%"})` : "✗ Pas de code promo"}</div>}
                          <textarea value={commentaireProprioVal} onChange={e => setCommentaireProprioVal(e.target.value)} placeholder="Commentaire..." style={{ ...inp, height: 60, resize: "vertical", fontSize: 12, marginBottom: 8 }} />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button style={{ ...btnP, marginTop: 0, fontSize: 13, padding: "9px" }} onClick={() => soumettreNoteLocataire(r.ref)}>Valider</button>
                            <button style={{ ...btnS, marginTop: 0, fontSize: 13, padding: "9px" }} onClick={() => { setNoteEnCoursRef(null); setNoteProprioVal(0); setCommentaireProprioVal(""); }}>Annuler</button>
                          </div>
                        </div>
                      ) : (
                        <button style={{ marginTop: 10, width: "100%", padding: "8px", borderRadius: 8, background: "#07a0f2", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }} onClick={() => { setNoteEnCoursRef(r.ref); setNoteProprioVal(0); setCommentaireProprioVal(""); }}>⭐ Noter ce locataire</button>
                      )
                    )}
                    <div style={{ fontSize: 11, color: "#aaa", marginTop: 5 }}>🔒 Tampon : {padH(parseFloat(r.heureDebut) - TAMPON)} – {padH(parseFloat(r.heureFin) + TAMPON)}</div>
                  </div>
                );
                  })}
                </div>
              ))}
            </div>
            );
          })()}

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
    <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
      <Header showSteps={true} />
      <div style={{ padding: "16px 16px 32px" }}>
        {/* Infos locataire */}
        <div style={card}>
          <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 19, color: "#07a0f2", marginBottom: 14, fontWeight: 700 }}>Votre réservation</div>
          {!compteConnecte && (
            <div style={{ background: "#e8f4f7", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: "#07a0f2" }}>
              💡 Déjà un compte ? <a href="#" onClick={e => { e.preventDefault(); setAuthMode("login"); setMode("auth"); }} style={{ color: "#07a0f2", fontWeight: 700 }}>Connectez-vous</a> pour retrouver vos réservations facilement.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div><label style={lbl}>Prénom *</label><input style={{ ...inp, border: erreurs.prenom ? "2px solid #FF6B6B" : "1.5px solid #b8e0f8" }} value={form.prenom} onChange={e => setF("prenom", e.target.value)} />{erreurs.prenom && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.prenom}</div>}</div>
            <div><label style={lbl}>Nom *</label><input style={{ ...inp, border: erreurs.nom ? "2px solid #FF6B6B" : "1.5px solid #b8e0f8" }} value={form.nom} onChange={e => setF("nom", e.target.value)} />{erreurs.nom && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.nom}</div>}</div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Email *</label>
            <input style={{ ...inp, border: erreurs.email ? "2px solid #FF6B6B" : "1.5px solid #b8e0f8" }} type="email" value={form.email}
              onChange={e => {
                setF("email", e.target.value);
                // Détecter si l'email correspond à un compte existant
                const val = e.target.value.trim().toLowerCase();
                const existe = !!comptes[val];
                setEmailExistant(existe);
                setLoginInlineMode(false);
                setLoginInlineMdp("");
                setLoginInlineErreur("");
              }} />
            {erreurs.email && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.email}</div>}
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Téléphone *</label>
            <input style={inp} type="tel" value={form.telephone} onChange={e => setF("telephone", e.target.value)} />
            {erreurs.telephone && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.telephone}</div>}
          </div>

          {/* Bloc compte : connexion ou création selon si l'email existe déjà */}
          {!compteConnecte && form.email.includes("@") && (
            emailExistant ? (
              /* Email déjà connu → proposer la connexion */
              <div style={{ background: "#fff8e1", border: "2px solid #f0c040", borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: "#a06000", fontSize: 14, marginBottom: 6 }}>👤 Compte existant détecté</div>
                <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 10 }}>
                  Un compte existe déjà pour <strong>{form.email}</strong>. Entrez votre mot de passe pour continuer.
                </div>
                <label style={lbl}>Mot de passe</label>
                <input type="password" value={loginInlineMdp} onChange={e => { setLoginInlineMdp(e.target.value); setLoginInlineErreur(""); }}
                  style={{ ...inp, border: erreurs.mdp ? "2px solid #FF6B6B" : "1.5px solid #b8e0f8", marginBottom: 6 }}
                  placeholder="Votre mot de passe" />
                {erreurs.mdp && <div style={{ color: "#FF6B6B", fontSize: 12 }}>❌ {erreurs.mdp}</div>}
                <button onClick={e => { e.preventDefault(); setResetEmail(form.email); ouvrirReset("locataire"); }}
                  style={{ background: "none", border: "none", color: "#6b7f8c", fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0, marginTop: 4 }}>
                  Mot de passe oublié ?
                </button>
              </div>
            ) : (
              /* Nouvel email → créer le compte */
              <div style={{ background: "#f0f9ff", border: "2px solid #39b8f5", borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: "#07a0f2", fontSize: 14, marginBottom: 4 }}>🆕 Création de votre compte</div>
                <div style={{ fontSize: 12, color: "#6b7f8c", marginBottom: 12 }}>
                  Un compte sera créé automatiquement pour retrouver vos réservations.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div>
                    <label style={lbl}>Adresse *</label>
                    <input style={{ ...inp, border: erreurs.adresse ? "2px solid #FF6B6B" : "1.5px solid #b8e0f8" }} value={form.adresse || ""} onChange={e => setF("adresse", e.target.value)} placeholder="Rue, numéro" />
                    {erreurs.adresse && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.adresse}</div>}
                  </div>
                  <div>
                    <label style={lbl}>Code postal *</label>
                    <input style={{ ...inp, border: erreurs.codePostal ? "2px solid #FF6B6B" : "1.5px solid #b8e0f8" }} maxLength={5} value={form.codePostal || ""} onChange={e => setF("codePostal", e.target.value)} />
                    {erreurs.codePostal && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.codePostal}</div>}
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={lbl}>Ville *</label>
                  <input style={{ ...inp, border: erreurs.ville ? "2px solid #FF6B6B" : "1.5px solid #b8e0f8" }} value={form.ville || ""} onChange={e => setF("ville", e.target.value)} />
                  {erreurs.ville && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.ville}</div>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={lbl}>Mot de passe * <span style={{ fontWeight: 400, color: "#aaa" }}>(8 car. min.)</span></label>
                    <input type="password" value={formMdp.motdepasse} onChange={e => setFormMdp(p => ({ ...p, motdepasse: e.target.value }))}
                      style={{ ...inp, border: erreurs.mdp ? "2px solid #FF6B6B" : "1.5px solid #b8e0f8" }} placeholder="••••••••" />
                    {erreurs.mdp && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.mdp}</div>}
                  </div>
                  <div>
                    <label style={lbl}>Confirmer *</label>
                    <input type="password" value={formMdp.motdepasse2} onChange={e => setFormMdp(p => ({ ...p, motdepasse2: e.target.value }))}
                      style={{ ...inp, border: erreurs.mdp2 ? "2px solid #FF6B6B" : "1.5px solid #b8e0f8" }} placeholder="••••••••" />
                    {erreurs.mdp2 && <div style={{ color: "#FF6B6B", fontSize: 11 }}>{erreurs.mdp2}</div>}
                  </div>
                </div>
              </div>
            )
          )}

          {compteConnecte && (
            <div style={{ background: "#e8f6fe", borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 13, color: "#07a0f2", display: "flex", alignItems: "center", gap: 8 }}>
              ✅ Connecté en tant que <strong>{comptes[compteConnecte]?.prenom} {comptes[compteConnecte]?.nom}</strong>
            </div>
          )}
        </div>

        {/* Calendrier */}
        <div style={card}>
          <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 19, color: "#07a0f2", marginBottom: 14, fontWeight: 700 }}>📅 Choisissez votre date</div>
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
            <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 19, color: "#07a0f2", marginBottom: 14, fontWeight: 700 }}>⏰ Choisissez vos horaires</div>
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
          <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 18, color: "#07a0f2", marginBottom: 12, fontWeight: 700 }}>Participants</div>
          {[{ key: "adultes", label: "Adultes", sousLabel: "12 ans et plus", tarif: `${TARIF_BASE} €/pers/h`, badge: null, min: 1 }, { key: "enfants12", label: "Enfants", sousLabel: "de 3 à 11 ans", tarif: `${TARIF_BASE * .5} €/pers/h`, badge: "-50%", min: 0 }, { key: "moins3", label: "Bébés", sousLabel: "moins de 3 ans", tarif: null, badge: "Gratuit", min: 0 }].map(({ key, label, sousLabel, tarif, badge, min }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#2C3E50" }}>{label}</span>
                  {/* Badge vert façon Swimmy pour les tarifs réduits/gratuits */}
                  {badge && <span style={{ background: "#2ecc71", color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 20, padding: "2px 9px" }}>{badge}</span>}
                </div>
                <div style={{ fontSize: 12, color: "#6b7f8c" }}>{sousLabel}{tarif ? ` · ${tarif}` : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <button onClick={() => setF(key, Math.max(min, form[key] - 1))} style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid #d5e5f0", background: "#fff", color: "#07a0f2", fontSize: 17, fontWeight: 700, cursor: "pointer" }}>−</button>
                <span style={{ fontWeight: 800, fontSize: 17, minWidth: 18, textAlign: "center" }}>{form[key]}</span>
                <button onClick={() => setF(key, form[key] + 1)} style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid #07a0f2", background: "#fff", color: "#07a0f2", fontSize: 17, fontWeight: 700, cursor: "pointer" }}>+</button>
              </div>
            </div>
          ))}
        </div>

        {/* Formules de groupe spéciales */}
        <div style={card}>
          <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 18, color: "#07a0f2", marginBottom: 4, fontWeight: 700 }}>👨‍👩‍👧‍👦 Formule groupe (optionnel)</div>
          <div style={{ fontSize: 12, color: "#6b7f8c", marginBottom: 12, lineHeight: 1.5 }}>
            Tarif forfaitaire pour une session de 3h. Non cumulable avec les remises fidélité, mais l'extra "Zéro vis-à-vis" reste offert.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div onClick={() => setF("formuleGroupe", form.formuleGroupe === "groupe10" ? null : "groupe10")}
              style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer", border: form.formuleGroupe === "groupe10" ? "2px solid #07a0f2" : "2px solid #e0e0e0", background: form.formuleGroupe === "groupe10" ? "#f0f9ff" : "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#2C3E50" }}>Groupe 10 personnes max</div>
                <div style={{ fontSize: 11, color: "#6b7f8c" }}>3h · soit 5€/pers/h</div>
              </div>
              <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 19, fontWeight: 700, color: "#07a0f2" }}>150 €</div>
            </div>
            <div onClick={() => setF("formuleGroupe", form.formuleGroupe === "groupe5" ? null : "groupe5")}
              style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer", border: form.formuleGroupe === "groupe5" ? "2px solid #07a0f2" : "2px solid #e0e0e0", background: form.formuleGroupe === "groupe5" ? "#f0f9ff" : "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#2C3E50" }}>Groupe 5 adultes max</div>
                <div style={{ fontSize: 11, color: "#6b7f8c" }}>3h · soit 5€/pers/h</div>
              </div>
              <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 19, fontWeight: 700, color: "#07a0f2" }}>75 €</div>
            </div>
          </div>
          {form.formuleGroupe && (
            <div style={{ marginTop: 10, background: "#fff8e1", borderRadius: 8, padding: "9px 12px", fontSize: 12, color: "#a06000", lineHeight: 1.5 }}>
              ⏱ Cette formule nécessite une session de <strong>3h pile</strong> et {form.formuleGroupe === "groupe10" ? "10 personnes maximum (adultes + enfants)" : "5 adultes maximum, sans enfant"}.
            </div>
          )}
          {erreurs.formuleGroupe && <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 8, padding: "6px 10px", background: "#fff0f0", borderRadius: 8 }}>{erreurs.formuleGroupe}</div>}
        </div>
        {form.creneaux.length > 0 && (
          <div style={{ background: "#07a0f2", borderRadius: 13, padding: "13px 16px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: "#b8e8f0", fontSize: 12 }}>{padH(heureDebut)} → {padH(heureFin)} ({formatDuree(nbSlots)})</div>
              {form.formuleGroupe ? (
                <div style={{ color: "#e0f4f8", fontSize: 11 }}>🎉 {FORMULES_GROUPE[form.formuleGroupe].label}</div>
              ) : (
                <div style={{ color: "#e0f4f8", fontSize: 11 }}>{form.adultes} adulte{form.adultes > 1 ? "s" : ""}{form.enfants12 > 0 ? ` + ${form.enfants12} enfant` : ""}</div>
              )}
              {!form.formuleGroupe && form.creneaux.some(h => h >= 20) && <div style={{ color: "#ffe082", fontSize: 11 }}>🌙 Majoration soirée incluse (+1€/pers/h après 20h)</div>}
              {remiseTranches > 0 && <div style={{ color: "#ffe082", fontSize: 11, fontWeight: 700 }}>🎁 Remise fidélité -{remiseTranches}% offerte !</div>}
              {remise > 0 && <div style={{ color: "#ffe082", fontSize: 11, fontWeight: 700 }}>Code promo -{remise}% ✓</div>}
            </div>
            <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 24, fontWeight: 700, color: "#fff" }}>{formatEur(prixFinal)}</div>
          </div>
        )}
        <button style={btnP} onClick={async () => { if (await validerEtape1()) setStep(2); }}>Continuer →</button>
        <button style={btnS} onClick={() => setMode("accueil")}>← Accueil</button>
      </div>
    </div>
  );

  // ── ÉTAPE 2 : Règlement ───────────────────────────────────────────────────
  if (mode === "locataire" && step === 2) return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
      <Header showSteps={true} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 19, color: "#07a0f2", marginBottom: 12, fontWeight: 700 }}>Règlement intérieur</div>
          <div style={{ background: "#f0f9ff", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#2C3E50", lineHeight: 1.7, maxHeight: 280, overflowY: "auto", border: "1px solid #b8e0f8", whiteSpace: "pre-line" }}>{REGLEMENT}</div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 12, marginTop: 16, cursor: "pointer" }}>
            <input type="checkbox" checked={form.reglementAccepte} onChange={e => setF("reglementAccepte", e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, accentColor: "#07a0f2" }} />
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
    <div style={{ fontFamily:"Inter,sans-serif", background:"#f8f9fa", minHeight:"100vh" }}>
      <Header showSteps={true}/>
      <div style={{ padding:"16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:19, color:"#07a0f2", marginBottom:6, fontWeight:700 }}>🎁 Options & extras</div>
          <div style={{ fontSize:13, color:"#6b7f8c", marginBottom:16, lineHeight:1.5 }}>
            Personnalisez votre session. Les tarifs sont calculés selon la quantité choisie.
          </div>

          {extras.filter(e => e.actif).map(e => {
            const qte = extrasChoisis[e.id] || 0;
            const offert = e.id === "e1" && zeroVisAVisOffert;
            const montant = offert ? 0 : (e.type === "personne"
              ? e.tarif * qte
              : e.tarif * (qte > 0 ? 1 : 0));
            const sel = qte > 0;
            return (
              <div key={e.id} style={{ borderRadius:13, marginBottom:12, border: offert ? "2px solid #39b8f5" : sel ? "2px solid #07a0f2" : "2px solid #e0e0e0", background: offert ? "#f0fffb" : sel ? "#f0f9ff" : "#fff", overflow:"hidden" }}>
                {/* En-tête */}
                <div style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"14px 14px 10px" }}>
                  {e.image ? <img src={e.image} alt="" style={{ width:38, height:38, borderRadius:8, objectFit:"cover", flexShrink:0 }} /> : <div style={{ fontSize:28, flexShrink:0 }}>{e.emoji}</div>}
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:14, color:"#2C3E50", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                      {e.nom}
                      {offert && <span style={{ background:"#39b8f5", color:"#fff", fontSize:10, fontWeight:700, borderRadius:20, padding:"2px 8px" }}>🎁 OFFERT</span>}
                    </div>
                    <div style={{ fontSize:12, color:"#6b7f8c", marginTop:2, lineHeight:1.4 }}>{e.description}</div>
                    <div style={{ fontSize:12, color:"#39b8f5", fontWeight:600, marginTop:4 }}>
                      {offert
                        ? <><span style={{ textDecoration:"line-through", color:"#bbb" }}>{e.tarif} €</span> Offert dès 30 € de réservation !</>
                        : (e.type === "personne" ? `${e.tarif} € / personne` : `${e.tarif} € forfait`)}
                    </div>
                  </div>
                </div>
                {/* Compteur */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderTop:"1px solid #e8f4f7", background: sel ? "#e8f6fe" : "#f9f9f9" }}>
                  {e.type === "personne" ? (
                    /* Compteur quantité */
                    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                      <button onClick={() => setExtrasChoisis(prev => ({ ...prev, [e.id]: Math.max(0, (prev[e.id]||0) - 1) }))}
                        style={{ width:32, height:32, borderRadius:"50%", border:"2px solid #07a0f2", background:"#fff", color:"#07a0f2", fontSize:18, fontWeight:700, cursor:"pointer" }}>−</button>
                      <span style={{ fontWeight:700, fontSize:18, minWidth:24, textAlign:"center", color:"#2C3E50" }}>{qte}</span>
                      <button onClick={() => setExtrasChoisis(prev => ({ ...prev, [e.id]: (prev[e.id]||0) + 1 }))}
                        style={{ width:32, height:32, borderRadius:"50%", border:"none", background:"#07a0f2", color:"#fff", fontSize:18, fontWeight:700, cursor:"pointer" }}>+</button>
                      <span style={{ fontSize:12, color:"#6b7f8c" }}>personne{qte > 1 ? "s" : ""}</span>
                    </div>
                  ) : (
                    /* Toggle forfait */
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div onClick={() => setExtrasChoisis(prev => ({ ...prev, [e.id]: prev[e.id] ? 0 : 1 }))}
                        style={{ width:46, height:26, borderRadius:13, background:sel?"#07a0f2":"#ddd", cursor:"pointer", position:"relative", transition:"background .2s" }}>
                        <div style={{ position:"absolute", top:3, left:sel?23:3, width:20, height:20, borderRadius:"50%", background:"#fff", transition:"left .2s", boxShadow:"0 1px 3px rgba(0,0,0,.2)" }}/>
                      </div>
                      <span style={{ fontSize:13, color:"#2C3E50", fontWeight:600 }}>{sel ? "Inclus" : "Non inclus"}</span>
                    </div>
                  )}
                  {/* Coût calculé */}
                  <div style={{ textAlign:"right" }}>
                    {sel ? (
                      offert
                        ? <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:16, fontWeight:700, color:"#39b8f5" }}>Gratuit 🎁</div>
                        : <div style={{ fontFamily:"'Nunito',sans-serif", fontSize:18, fontWeight:700, color:"#07a0f2" }}>{formatEur(montant)}</div>
                    ) : (
                      <div style={{ fontSize:13, color:"#bbb" }}>0,00 €</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {extras.filter(e => e.actif).length === 0 && (
            <div style={{ color:"#6b7f8c", fontSize:13, textAlign:"center", padding:"16px 0" }}>Aucun extra disponible.</div>
          )}

          {montantZeroVisAVisOffert > 0 && (
            <div style={{ background:"#e8f6fe", border:"1.5px solid #39b8f5", borderRadius:10, padding:"10px 14px", marginTop:8, textAlign:"center", fontSize:13, color:"#07a0f2", fontWeight:700 }}>
              🎁 Vous économisez {formatEur(montantZeroVisAVisOffert)} grâce à l'offre "Zéro vis-à-vis" !
            </div>
          )}
          {totalExtras > 0 && (
            <div style={{ background:"#07a0f2", borderRadius:10, padding:"12px 16px", marginTop:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:14, fontWeight:700, color:"#fff" }}>Total extras</span>
              <span style={{ fontSize:20, fontWeight:700, color:"#fff", fontFamily:"'Nunito',sans-serif" }}>{formatEur(totalExtras)}</span>
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
    <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
      <Header showSteps={true} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 19, color: "#07a0f2", marginBottom: 12, fontWeight: 700 }}>Récapitulatif & Paiement</div>
          <div style={{ background: "#f0f9ff", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #b8e0f8" }}>
            {[["Locataire", `${form.prenom} ${form.nom}`], ["Date", form.date], ["Créneau", `${padH(heureDebut)} → ${padH(heureFin)} (${formatDuree(nbSlots)})`], ["Participants", `${form.adultes} adulte${form.adultes > 1 ? "s" : ""}${form.enfants12 > 0 ? ` + ${form.enfants12} enfant` : ""}${form.moins3 > 0 ? ` + ${form.moins3} bébé` : ""}`]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "#6b7f8c", fontSize: 13 }}>{k}</span><span style={{ fontWeight: 600, fontSize: 13 }}>{v}</span>
              </div>
            ))}
            <div style={{ height: 1, background: "#b8e0f8", margin: "8px 0" }} />
            {remiseTranches > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: "#07a0f2", fontSize: 13, fontWeight: 700 }}>🎁 Remise fidélité -{remiseTranches}%</span><span style={{ color: "#07a0f2", fontSize: 13, fontWeight: 700 }}>offerte</span></div>}
            {remise > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: "#39b8f5", fontSize: 13, fontWeight: 600 }}>Code promo -{remise}%</span><span style={{ color: "#39b8f5", fontSize: 13, fontWeight: 600 }}>-{formatEur((prix * remise) / 100)}</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "#07a0f2" }}>Total</span>
              <div style={{ textAlign: "right" }}>
                {remiseTotalePct > 0 && <div style={{ fontSize: 12, color: "#aaa", textDecoration: "line-through" }}>{formatEur(prix)}</div>}
                <span style={{ fontWeight: 700, fontSize: 19, color: "#07a0f2" }}>{formatEur(prixFinal)}</span>
              </div>
            </div>
          </div>
          {/* Code promo */}
          <div style={{ background: "#f7f0e6", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #e0d4c0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#07a0f2", marginBottom: 8 }}>🎁 Vous avez un code promo ?</div>
            {codePromoStatut === "ok" ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#e8f6fe", borderRadius: 8, padding: "8px 12px", border: "1.5px solid #39b8f5" }}>
                <div><span style={{ fontWeight: 700, color: "#07a0f2", fontFamily: "monospace", fontSize: 14 }}>{codePromoSaisi.toUpperCase()}</span><span style={{ color: "#39b8f5", fontWeight: 600, fontSize: 13, marginLeft: 8 }}>✓ -{remise}% appliqué</span></div>
                <button onClick={annulerCode} style={{ background: "none", border: "none", color: "#FF6B6B", cursor: "pointer", fontSize: 18, fontWeight: 700 }}>×</button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={codePromoSaisi} onChange={e => { setCodePromoSaisi(e.target.value.toUpperCase()); setCodePromoStatut(null); }} placeholder="PISCINE-XXXXX" style={{ ...inp, flex: 1, fontSize: 14, fontFamily: "monospace", border: codePromoStatut && codePromoStatut !== "ok" ? "2px solid #FF6B6B" : "1.5px solid #b8e0f8" }} />
                  <button onClick={verifierCode} style={{ padding: "10px 14px", borderRadius: 8, background: "#07a0f2", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>Appliquer</button>
                </div>
                {codePromoStatut === "invalide" && <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 5 }}>❌ Code invalide.</div>}
                {codePromoStatut === "utilise" && <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 5 }}>❌ Ce code a déjà été utilisé.</div>}
                {codePromoStatut === "expire" && <div style={{ color: "#FF6B6B", fontSize: 12, marginTop: 5 }}>❌ Ce code est expiré.</div>}
              </>
            )}
          </div>
          {/* Récap extras */}
          {Object.values(extrasChoisis).some(q => q > 0) && (
            <div style={{ background: "#f0f9ff", borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: "1px solid #b8e0f8" }}>
              <div style={{ fontWeight: 700, color: "#07a0f2", fontSize: 13, marginBottom: 8 }}>🎁 Extras sélectionnés</div>
              {extras.filter(e => extrasChoisis[e.id] > 0).map(e => {
                const qte = extrasChoisis[e.id] || 0;
                const nb = e.type === "personne" ? qte : 1;
                const offert = e.id === "e1" && zeroVisAVisOffert;
                return (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span style={{ color: "#2C3E50" }}>{e.emoji} {e.nom}{e.type === "personne" ? ` ×${qte} pers.` : " (forfait)"}</span>
                    <span style={{ fontWeight: 600, color: offert ? "#39b8f5" : "#07a0f2" }}>{offert ? "Gratuit 🎁" : formatEur(e.tarif * nb)}</span>
                  </div>
                );
              })}
              <div style={{ height: 1, background: "#b8e0f8", margin: "8px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#07a0f2" }}>
                <span>Total extras</span><span>{formatEur(totalExtras)}</span>
              </div>
            </div>
          )}

          {/* Total général */}
          <div style={{ background: "#07a0f2", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>Total général</span>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 22, fontFamily: "'Nunito',sans-serif" }}>{formatEur(totalGeneral)}</span>
          </div>

          {/* Mode de paiement */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#07a0f2", marginBottom: 10 }}>💳 Mode de paiement</div>
            <div style={{ display: "flex", gap: 10 }}>
              {[
                { val: "cb", emoji: "💳", label: "Carte bancaire", desc: "Paiement en ligne à l'acceptation" },
                { val: "especes", emoji: "💵", label: "Espèces", desc: "Acompte 20% en ligne, solde le jour J" },
              ].map(({ val, emoji, label, desc }) => (
                <div key={val} onClick={() => setModePaiement(val)}
                  style={{ flex: 1, padding: "12px 10px", borderRadius: 12, cursor: "pointer", textAlign: "center", border: modePaiement === val ? "2px solid #07a0f2" : "2px solid #e0e0e0", background: modePaiement === val ? "#f0f9ff" : "#fff", transition: "all .15s" }}>
                  <div style={{ fontSize: 26, marginBottom: 4 }}>{emoji}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#2C3E50" }}>{label}</div>
                  <div style={{ fontSize: 11, color: "#6b7f8c", marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Détail selon mode */}
          {modePaiement === "especes" && (
            <div style={{ background: "#fff8e1", borderRadius: 10, padding: "12px 14px", border: "2px solid #f0c040", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: "#a06000", fontSize: 13, marginBottom: 6 }}>💵 Détail paiement espèces</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: "#6b7f8c" }}>Acompte à régler en ligne (20%)</span>
                <span style={{ fontWeight: 700, color: "#a06000" }}>{formatEur(acompte)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#6b7f8c" }}>Reste à régler le jour J (espèces)</span>
                <span style={{ fontWeight: 700, color: "#2C3E50" }}>{formatEur(resteARegler)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#a06000", marginTop: 8, lineHeight: 1.4 }}>
                Aucun débit maintenant. Si le propriétaire accepte votre demande, vous recevrez un lien de paiement sécurisé par email pour régler l'acompte.
              </div>
            </div>
          )}
          {modePaiement === "cb" && (
            <div style={{ background: "#e8f6fe", borderRadius: 10, padding: "10px 14px", marginBottom: 12, border: "1px solid #39b8f5" }}>
              <div style={{ fontSize: 13, color: "#07a0f2" }}>✓ Aucun débit maintenant.</div>
              <div style={{ fontSize: 11, color: "#6b7f8c", marginTop: 6, lineHeight: 1.4 }}>
                Si le propriétaire accepte votre demande, vous recevrez un lien de paiement sécurisé par email pour régler {formatEur(totalGeneral)}. Le créneau n'est garanti qu'une fois ce paiement effectué.
              </div>
            </div>
          )}

          <div style={{ border: "2px dashed #b8e0f8", borderRadius: 10, padding: "12px", textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 20, marginBottom: 3 }}>📩</div>
            <div style={{ fontWeight: 600, color: "#07a0f2", marginBottom: 2 }}>Paiement uniquement après acceptation</div>
            <div style={{ fontSize: 12, color: "#6b7f8c" }}>Aucune donnée bancaire n'est demandée à cette étape. Vous recevrez un lien de paiement sécurisé (Stripe) par email si le propriétaire accepte votre demande.</div>
          </div>

          {/* ── Vérification téléphone par SMS ── */}
          {modePaiement && (
            <div style={{ background: otpVerifie ? "#e8f6fe" : "#f0f9ff", border: `2px solid ${otpVerifie ? "#39b8f5" : "#b8e0f8"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
              {otpVerifie ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 22 }}>✅</div>
                  <div>
                    <div style={{ fontWeight: 700, color: "#07a0f2", fontSize: 14 }}>Téléphone vérifié</div>
                    <div style={{ fontSize: 12, color: "#6b7f8c" }}>Votre numéro a été confirmé. Vous pouvez finaliser votre réservation.</div>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 700, color: "#07a0f2", fontSize: 14, marginBottom: 6 }}>🔐 Vérification de votre téléphone</div>
                  <div style={{ fontSize: 12, color: "#6b7f8c", marginBottom: 10 }}>
                    Pour confirmer votre réservation, nous devons vérifier votre numéro <strong>{form.telephone}</strong> par SMS.
                  </div>
                  {!otpEnvoye ? (
                    <>
                      <button
                        onClick={() => envoyerOTP("sms")}
                        disabled={otpEnCours}
                        style={{ width: "100%", padding: "11px", borderRadius: 9, background: "#07a0f2", color: "#fff", border: "none", fontWeight: 700, fontSize: 14, cursor: otpEnCours ? "not-allowed" : "pointer", opacity: otpEnCours ? 0.7 : 1 }}>
                        {otpEnCours ? "Envoi en cours…" : "📲 Recevoir mon code par SMS"}
                      </button>
                      <button onClick={() => envoyerOTP("email")} disabled={otpEnCours}
                        style={{ width: "100%", marginTop: 8, background: "none", border: "none", color: "#0480c4", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                        Je préfère recevoir le code par email
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: "#07a0f2", background: "#e8f6fe", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
                        {otpCanal === "email"
                          ? <>📧 Un code à 6 chiffres a été envoyé par email à <strong>{form.email}</strong>. Valable 10 minutes — pensez à vérifier vos spams.</>
                          : <>📲 Un code à 6 chiffres a été envoyé par SMS au <strong>{form.telephone}</strong>. Valable 10 minutes.</>}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="Code à 6 chiffres"
                          value={otpSaisi}
                          onChange={e => { setOtpSaisi(e.target.value.replace(/\D/g,"")); setOtpErreur(""); }}
                          style={{ flex: 1, padding: "11px 14px", borderRadius: 9, border: otpErreur ? "2px solid #FF6B6B" : "2px solid #b8e0f8", fontSize: 18, fontWeight: 700, letterSpacing: 6, textAlign: "center" }}
                        />
                        <button
                          onClick={validerOTP}
                          style={{ padding: "11px 18px", borderRadius: 9, background: "#07a0f2", color: "#fff", border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                          Valider
                        </button>
                      </div>
                      {otpErreur && <div style={{ fontSize: 12, color: "#FF6B6B", marginBottom: 6 }}>❌ {otpErreur}</div>}
                      {/* Recours toujours visible : personne ne doit rester bloqué faute de SMS */}
                      {otpCanal === "sms" && (
                        <div style={{ background: "#fff8e1", border: "1px solid #f0c040", borderRadius: 8, padding: "9px 11px", marginBottom: 8 }}>
                          <div style={{ fontSize: 12, color: "#a06000", marginBottom: 6 }}>Vous ne recevez pas le SMS ?</div>
                          <button onClick={() => envoyerOTP("email")} disabled={otpEnCours}
                            style={{ padding: "7px 14px", borderRadius: 50, background: "#fff", color: "#a06000", border: "1.5px solid #f0c040", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                            📧 Recevoir le code par email
                          </button>
                        </div>
                      )}
                      <button onClick={() => envoyerOTP(otpCanal)} disabled={otpEnCours}
                        style={{ fontSize: 12, color: "#6b7f8c", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                        Renvoyer le code {otpCanal === "email" ? "par email" : "par SMS"}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          <button
            style={{ ...btnP, opacity: (modePaiement && otpVerifie) ? 1 : 0.4 }}
            onClick={() => modePaiement && otpVerifie && confirmerReservation()}>
            ✓ Envoyer ma demande de réservation
          </button>
          <button style={btnS} onClick={() => setStep(3)}>← Retour</button>
        </div>
        <div style={{ textAlign:"center", fontSize:12, color:"#6b7f8c", marginTop:8 }}>
          Aucun paiement maintenant — vous serez recontacté(e) après validation par le propriétaire.
        </div>
      </div>
    </div>
  );

  // ── PAGE ÉTAT DES LIEUX D'ENTRÉE (le jour J, depuis Mon compte ou la bannière) ──
  if (mode === "edlEntree") return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 19, color: "#07a0f2", marginBottom: 6, fontWeight: 700 }}>État des lieux — Arrivée</div>
          <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 6 }}>Réservation {reservation?.ref}</div>
          <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 14, lineHeight: 1.5 }}>
            Pour chaque élément, vérifiez qu'il est bien <strong>présent</strong> et <strong>fonctionnel</strong> (les photos de référence de la propriétaire sont affichées). En cas de souci, décochez et précisez dans les commentaires.
          </div>
          {elementsEdl.map(item => {
            const rep = edlReponses[item] || { present: true, fonctionnel: true };
            const refPhotos = inventaire[item] || [];
            return (
              <div key={item} style={{ borderBottom: "1px solid #e8f4f7", paddingBottom: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#2C3E50", marginBottom: 6 }}>{item}</div>
                {refPhotos.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    {refPhotos.map((p, i) => <img key={i} src={p.data || p} alt={item} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "2px solid #f0c040" }} />)}
                  </div>
                )}
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {[["present", "Présent"], ["fonctionnel", "Fonctionnel"]].map(([cle, label]) => (
                    <div key={cle} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 13, color: "#6b7f8c" }}>{label} :</span>
                      {[[true, "Oui"], [false, "Non"]].map(([val, txt]) => (
                        <button key={txt} type="button" onClick={() => setEdlReponses(prev => ({ ...prev, [item]: { ...rep, [cle]: val } }))}
                          style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", border: rep[cle] === val ? "2px solid " + (val ? "#2ecc71" : "#FF6B6B") : "2px solid #e0e0e0", background: rep[cle] === val ? (val ? "#e8faf0" : "#fff0f0") : "#fff", color: rep[cle] === val ? (val ? "#1a9850" : "#c0302a") : "#888" }}>
                          {txt}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#07a0f2", marginBottom: 5 }}>💬 Commentaires libres (facultatif)</div>
            <textarea value={edlCommentaire} onChange={e => setEdlCommentaire(e.target.value)} rows={3}
              placeholder="Mobilier non listé, remarque sur l'état de quelque chose..."
              style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1.5px solid #b8e0f8", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#07a0f2", marginBottom: 5 }}>✍️ Votre signature</div>
            <ZoneSignature onChange={setEdlSignature} />
          </div>
          <button style={{ ...btnP, opacity: edlSignature ? 1 : 0.5 }} onClick={() => edlSignature && validerEdlEntree()}>✓ Valider et commencer la session</button>
          {!edlSignature && <div style={{ fontSize: 12, color: "#a06000", textAlign: "center", marginTop: 6 }}>La signature est requise pour valider.</div>}
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
      <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
        <Header showSteps={true} />
        <div style={{ padding: "16px 16px 32px" }}>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>⏳</div>
            <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 21, color: "#07a0f2", fontWeight: 700, marginBottom: 6 }}>Demande envoyée !</div>
            <div style={{ display: "inline-block", background: "#f0c040", color: "#fff", borderRadius: 8, padding: "4px 13px", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{reservation?.ref}</div>
            <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 14, lineHeight: 1.7 }}>
              Votre demande de réservation est <strong>en attente de validation</strong> par le propriétaire.<br/>
              Vous recevrez un email à <strong>{form.email}</strong> dès qu'elle sera traitée.
            </div>
            <div style={{ background: "#fff8e1", borderRadius: 10, padding: "11px 13px", border: "2px solid #f0c040", marginBottom: 12, textAlign: "left" }}>
              <div style={{ fontWeight: 700, color: "#a06000", marginBottom: 4 }}>ℹ️ Que se passe-t-il maintenant ?</div>
              <div style={{ fontSize: 13, color: "#2C3E50", lineHeight: 1.6 }}>
                Le propriétaire va examiner votre demande. Si elle est acceptée, vous recevrez un lien de paiement par email pour confirmer définitivement votre créneau. Si elle est refusée, aucune somme ne vous sera demandée.
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
      <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
        <Header showSteps={true} />
        <div style={{ padding: "16px 16px 32px" }}>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>😔</div>
            <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 21, color: "#FF6B6B", fontWeight: 700, marginBottom: 6 }}>Demande refusée</div>
            <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 14, lineHeight: 1.7 }}>
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
      <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
        <Header showSteps={true} />
        <div style={{ padding: "16px 16px 32px" }}>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>🚫</div>
            <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 21, color: "#FF6B6B", fontWeight: 700, marginBottom: 6 }}>Réservation annulée</div>
            <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 14, lineHeight: 1.7 }}>
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
      <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
        <Header showSteps={true} />
        <div style={{ padding: "16px 16px 32px" }}>
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 6 }}>🎉</div>
            <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 21, color: "#07a0f2", fontWeight: 700, marginBottom: 6 }}>Réservation confirmée !</div>
            <div style={{ display: "inline-block", background: "#39b8f5", color: "#fff", borderRadius: 8, padding: "4px 13px", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{reservation?.ref}</div>
            <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 14, lineHeight: 1.7 }}>Confirmation envoyée à <strong>{form.email}</strong>.<br />Profitez bien ! 🌊</div>
            <div style={{ background: "#e8f6fe", borderRadius: 10, padding: "11px 13px", border: "2px solid #39b8f5", marginBottom: 12, textAlign: "left" }}>
              <div style={{ fontWeight: 700, color: "#07a0f2", marginBottom: 4 }}>📅 Le jour de votre venue</div>
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
    <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={card}>
          <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 19, color: "#07a0f2", marginBottom: 6, fontWeight: 700 }}>État des lieux — Départ</div>
          <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 6 }}>Réservation {reservation?.ref}</div>
          <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 14, lineHeight: 1.5 }}>
            Vérifiez chaque élément dans l'état où vous le laissez : toujours <strong>présent</strong> et <strong>fonctionnel</strong> ?
          </div>
          {elementsEdl.map(item => {
            const rep = edlReponsesSortie[item] || { present: true, fonctionnel: true };
            const refPhotos = inventaire[item] || [];
            return (
              <div key={item} style={{ borderBottom: "1px solid #e8f4f7", paddingBottom: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#2C3E50", marginBottom: 6 }}>{item}</div>
                {refPhotos.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    {refPhotos.map((p, i) => <img key={i} src={p.data || p} alt={item} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "2px solid #f0c040" }} />)}
                  </div>
                )}
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {[["present", "Présent"], ["fonctionnel", "Fonctionnel"]].map(([cle, label]) => (
                    <div key={cle} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 13, color: "#6b7f8c" }}>{label} :</span>
                      {[[true, "Oui"], [false, "Non"]].map(([val, txt]) => (
                        <button key={txt} type="button" onClick={() => setEdlReponsesSortie(prev => ({ ...prev, [item]: { ...rep, [cle]: val } }))}
                          style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", border: rep[cle] === val ? "2px solid " + (val ? "#2ecc71" : "#FF6B6B") : "2px solid #e0e0e0", background: rep[cle] === val ? (val ? "#e8faf0" : "#fff0f0") : "#fff", color: rep[cle] === val ? (val ? "#1a9850" : "#c0302a") : "#888" }}>
                          {txt}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#07a0f2", marginBottom: 5 }}>💬 Commentaires libres (facultatif)</div>
            <textarea value={edlCommentaireSortie} onChange={e => setEdlCommentaireSortie(e.target.value)} rows={3}
              placeholder="Mobilier non listé, remarque sur l'état de quelque chose..."
              style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1.5px solid #b8e0f8", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
          </div>
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
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#07a0f2", marginBottom: 5 }}>✍️ Votre signature</div>
            <ZoneSignature onChange={setEdlSignatureSortie} />
          </div>
          <button style={{ ...btnP, opacity: edlSignatureSortie ? 1 : 0.5 }} onClick={() => edlSignatureSortie && cloturerSession()}>✓ Clôturer la session</button>
          {!edlSignatureSortie && <div style={{ fontSize: 12, color: "#a06000", textAlign: "center", marginTop: 6 }}>La signature est requise pour clôturer.</div>}
        </div>
      </div>
    </div>
  );

  // ── ÉTAPE 7 : Avis ────────────────────────────────────────────────────────
  if (mode === "locataire" && step === 7) return (
    <div style={{ fontFamily: "Inter,sans-serif", background: "#f8f9fa", minHeight: "100vh" }}>
      <Header showSteps={false} />
      <div style={{ padding: "16px 16px 32px" }}>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>✅</div>
          <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 21, color: "#07a0f2", fontWeight: 700, marginBottom: 6 }}>Session clôturée !</div>
          <div style={{ fontSize: 13, color: "#6b7f8c" }}>Merci pour votre visite 🌊</div>
        </div>
        {!avisEnvoye ? (
          <div style={card}>
            <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 17, color: "#07a0f2", marginBottom: 6, fontWeight: 700, textAlign: "center" }}>Votre avis nous est précieux</div>
            <div style={{ fontSize: 13, color: "#6b7f8c", textAlign: "center", marginBottom: 10 }}>Si vous avez été un locataire exemplaire, vous pourriez recevoir un <strong>code -5%</strong> valable 1 mois !</div>
            <Stars value={note} onChange={setNote} />
            <div style={{ marginTop: 10 }}><label style={lbl}>Commentaire (optionnel)</label><textarea value={commentaire} onChange={e => setCommentaire(e.target.value)} placeholder="Partagez votre expérience..." style={{ ...inp, height: 80, resize: "vertical", fontSize: 13 }} /></div>
            <button style={{ ...btnP, opacity: note === 0 ? .5 : 1 }} onClick={soumettreAvis}>Envoyer mon avis</button>
          </div>
        ) : (() => {
          const noteP = notesLocataires[reservation?.ref];
          // Le code promo est stocké directement dans la réservation (persisté en base)
          const resActuelle = reservations.find(r => r.ref === reservation?.ref);
          const promoRecue = resActuelle?.codePromo;
          if (!noteP) return (
            <div style={card}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>⏳</div>
                <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 17, color: "#07a0f2", fontWeight: 700, marginBottom: 8 }}>Merci pour votre avis !</div>
                <div style={{ fontSize: 13, color: "#6b7f8c", lineHeight: 1.7 }}>{"⭐".repeat(note)} — votre retour a bien été enregistré.<br />Si le propriétaire vous attribue 4 étoiles ou plus, vous recevrez un <strong>code -5%</strong>.</div>
              </div>
            </div>
          );
          if (noteP.note >= 4 && promoRecue) return (
            <div style={card}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>🎁</div>
                <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 17, color: "#07a0f2", fontWeight: 700, marginBottom: 6 }}>Bravo, vous méritez une réduction !</div>
                <div style={{ fontSize: 13, color: "#6b7f8c", marginBottom: 14 }}>Le propriétaire vous a attribué <strong>{"⭐".repeat(noteP.note)}</strong>.<br />Code <strong>-{promoRecue?.taux || 5}%</strong> valable jusqu'au <strong>{promoRecue?.expiration}</strong> :</div>
                <div style={{ background: "#07a0f2", borderRadius: 12, padding: "14px 18px", display: "inline-block", marginBottom: 12 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: 2, fontFamily: "monospace" }}>{promoRecue?.code}</div>
                  <div style={{ fontSize: 11, color: "#b8e8f0", marginTop: 2 }}>-5% · usage unique · 1 mois</div>
                </div>
                <div style={{ fontSize: 12, color: "#6b7f8c" }}>📋 Copiez ce code pour votre prochaine réservation.</div>
              </div>
            </div>
          );
          if (noteP.note >= 4 && !promoRecue) return (
            <div style={card}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>⏳</div>
                <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 17, color: "#07a0f2", fontWeight: 700, marginBottom: 8 }}>Super note reçue !</div>
                <div style={{ fontSize: 13, color: "#6b7f8c", lineHeight: 1.7 }}>{"⭐".repeat(noteP.note)} — votre code -5% est en cours de génération.<br />Revenez dans quelques instants ou rafraîchissez la page.</div>
              </div>
            </div>
          );
          return (
            <div style={card}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>🌊</div>
                <div style={{ fontFamily: "'Nunito',sans-serif", fontSize: 17, color: "#07a0f2", fontWeight: 700, marginBottom: 8 }}>Merci pour votre visite !</div>
                <div style={{ fontSize: 13, color: "#6b7f8c", lineHeight: 1.7 }}>Votre avis a bien été pris en compte.<br />Nous espérons vous revoir bientôt ! 😊</div>
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
