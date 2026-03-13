const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const Groq    = require('groq-sdk');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ─── Configuration ───────────────────────────────────────────────────────────
const CONFIG = {
  GROQ_API_KEY:    process.env.GROQ_API_KEY || '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', // ← Clé API Groq (console.groq.com)
  FILE_TO_DELIVER: './protected/Boosteo.apk',              // ← Ton fichier à livrer
  PAYMENT_AMOUNT:  '101900',                                           // ← Montant exact attendu en Ar
  USSD_CODE:       '*144*1*1*0340000000*5000%23',                    // ← Code USSD MVola/Orange Money
};

// ─── Initialisation Groq (gratuit, 14 400 requêtes/jour) ─────────────────────
const groq = new Groq({ apiKey: CONFIG.GROQ_API_KEY });

// ─── Stockage temporaire des sessions de paiement ────────────────────────────
const paymentSessions = new Map();
// Structure: { status: 'pending'|'analyzing'|'validated'|'rejected'|'downloaded', timestamp, imagePath }

// ─── Upload des captures d'écran ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const sessionId = req.body.sessionId || Date.now();
    cb(null, `proof_${sessionId}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont acceptées'));
  },
});

// ─── Analyse de l'image avec Groq (llama-4-scout — vision gratuite) ──────────
async function analyzePaymentProof(imagePath, mimeType) {
  const imageData = fs.readFileSync(imagePath).toString('base64');
  const dataUrl   = `data:${mimeType};base64,${imageData}`;

  const prompt =
    `Tu es un vérificateur de paiement mobile Madagascar (MVola / Orange Money / Airtel Money).\n` +
    `Analyse cette capture d'écran et réponds UNIQUEMENT par le mot "True" ou "False".\n\n` +
    `Réponds "True" si ET SEULEMENT SI toutes ces conditions sont remplies :\n` +
    `  1. C'est bien une capture de confirmation de paiement réussi\n` +
    `  2. Le montant affiché est exactement ${CONFIG.PAYMENT_AMOUNT} Ar\n` +
    `  3. Le statut du paiement est "succès" / "confirmé" / "effectué"\n\n` +
    `Réponds "False" dans tous les autres cas (mauvais montant, paiement échoué, image floue, autre type d'image, etc.).\n\n` +
    `Réponds avec un seul mot : True ou False.`;

  const response = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct', // modèle vision gratuit Groq
    max_tokens: 10,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text',      text: prompt },
        ],
      },
    ],
  });

  const raw    = response.choices[0].message.content.trim().toLowerCase().replace(/[^a-z]/g, '');
  const answer = raw.startsWith('true') ? 'true' : raw.startsWith('false') ? 'false' : 'unknown';
  console.log(`🤖 Groq répond : "${response.choices[0].message.content.trim()}" → interprété : "${answer}"`);
  return answer === 'true';
}

// ─── Routes API ──────────────────────────────────────────────────────────────

// 1. Créer une session de paiement
app.post('/api/session/create', (req, res) => {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  paymentSessions.set(sessionId, {
    status:    'pending',
    timestamp: Date.now(),
  });
  console.log(`🆕 Session créée : ${sessionId}`);
  res.json({ sessionId, ussdCode: CONFIG.USSD_CODE });
});

// 2. Soumettre la capture → analyse automatique par Gemini
app.post('/api/payment/submit', upload.single('proof'), async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId || !paymentSessions.has(sessionId)) {
    return res.status(400).json({ error: 'Session invalide ou expirée.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Image requise.' });
  }

  // Passer immédiatement en "analyzing" pour que le frontend affiche le spinner
  paymentSessions.set(sessionId, {
    ...paymentSessions.get(sessionId),
    status:    'analyzing',
    imagePath: req.file.path,
    mimeType:  req.file.mimetype,
  });

  res.json({ success: true, message: 'Analyse en cours…' });

  // ── Analyse asynchrone (ne bloque pas la réponse HTTP) ──────────────────────
  setImmediate(async () => {
    try {
      console.log(`🔍 Analyse Groq pour session ${sessionId}…`);
      const isValid = await analyzePaymentProof(req.file.path, req.file.mimetype);

      const newStatus = isValid ? 'validated' : 'rejected';
      paymentSessions.set(sessionId, {
        ...paymentSessions.get(sessionId),
        status: newStatus,
      });

      console.log(isValid
        ? `✅ Paiement VALIDÉ — session ${sessionId}`
        : `❌ Paiement REJETÉ — session ${sessionId}`
      );

      // Nettoyage de l'image après analyse
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    } catch (err) {
      console.error(`❌ Erreur Groq pour session ${sessionId} :`, err.message);

      // Statut "error" distinct de "rejected" :
      // "rejected" = paiement analysé mais invalide
      // "error"    = problème technique (quota Groq, réseau, etc.) → le client peut réessayer
      paymentSessions.set(sessionId, {
        ...paymentSessions.get(sessionId),
        status: 'error',
        error:  err.message,
      });
    }
  });
});

// 3. Polling du statut depuis le frontend
app.get('/api/payment/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  if (!paymentSessions.has(sessionId)) {
    return res.status(404).json({ error: 'Session introuvable.' });
  }

  const session = paymentSessions.get(sessionId);
  res.json({ status: session.status });
});

// 4. Télécharger le fichier si paiement validé
app.get('/api/download/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  if (!paymentSessions.has(sessionId)) {
    return res.status(404).json({ error: 'Session introuvable.' });
  }

  const session = paymentSessions.get(sessionId);

  if (session.status !== 'validated') {
    return res.status(403).json({ error: 'Paiement non validé.' });
  }
  if (!fs.existsSync(CONFIG.FILE_TO_DELIVER)) {
    return res.status(404).json({ error: 'Fichier introuvable sur le serveur.' });
  }

  paymentSessions.set(sessionId, { ...session, status: 'downloaded' });
  console.log(`⬇️  Téléchargement — session ${sessionId}`);
  res.download(CONFIG.FILE_TO_DELIVER, 'fichier_numerique.pdf');
});

// ─── Nettoyage sessions expirées toutes les 5 min (TTL : 30 min) ─────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of paymentSessions.entries()) {
    if (now - session.timestamp > 30 * 60 * 1000) {
      if (session.imagePath && fs.existsSync(session.imagePath)) {
        fs.unlinkSync(session.imagePath);
      }
      paymentSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ─── Démarrage ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚀 Serveur lancé    : http://localhost:${PORT}`);
  console.log(`📁 Fichier à livrer : ${CONFIG.FILE_TO_DELIVER}`);
  console.log(`🤖 IA d'analyse     : Groq — Llama 4 Scout Vision (gratuit)`);
  console.log(`💰 Montant attendu  : ${CONFIG.PAYMENT_AMOUNT} Ar`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (CONFIG.GROQ_API_KEY === 'COLLE_TA_CLE_ICI') {
    console.warn('⚠️  GROQ_API_KEY non configurée !');
    console.warn('   → Obtiens ta clé gratuite sur https://console.groq.com');
    console.warn('   → Puis lance : GROQ_API_KEY=ta_cle node server.js');
  }
});
