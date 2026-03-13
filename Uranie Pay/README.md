# 💳 Système de Paiement Numérique
## USSD + Gemini Flash (IA gratuite) + Livraison Fichier

## Architecture

```
Client (navigateur)
  │
  ├─ 1. Clic bouton → compose USSD (MVola / Orange Money)
  ├─ 2. Upload capture d'écran du paiement
  │
Serveur Express (Node.js)
  │
  ├─ Reçoit l'image → envoie à Gemini Flash pour analyse IA
  ├─ Gemini répond True ou False automatiquement (< 3 secondes)
  └─ Si True → téléchargement automatique du fichier
```

## ✅ Pourquoi Gemini Flash ?
- **Gratuit** : 1 500 requêtes/jour, pas de carte bancaire
- **Rapide** : réponse en 1–3 secondes
- **Précis** : reconnaît les SMS MVola, Orange Money, Airtel Money
- **Automatique** : zéro intervention humaine

## Installation

```bash
npm install
```

## Configuration (dans server.js)

```js
const CONFIG = {
  GEMINI_API_KEY:  process.env.GEMINI_API_KEY || 'COLLE_TA_CLE_ICI',
  FILE_TO_DELIVER: './protected/fichier_numerique.pdf',
  PAYMENT_AMOUNT:  '5000',
  USSD_CODE:       '*144*1*1*0340000000*5000%23',
};
```

## Obtenir ta clé Gemini GRATUITE

1. Va sur **https://aistudio.google.com**
2. Connecte-toi avec un compte Google
3. Clique **"Get API Key"** → **"Create API key"**
4. Copie la clé (commence par `AIza...`)

## Démarrage

```bash
# Méthode 1 — variable d'environnement (recommandé)
GEMINI_API_KEY=AIzaSy... node server.js

# Méthode 2 — coller directement dans server.js
GEMINI_API_KEY: 'AIzaSy...'

# Ouvre ensuite http://localhost:3000
```

## Structure du projet

```
projet/
├── server.js          ← Backend Node.js + Gemini
├── package.json
├── README.md
├── .gitignore
├── public/
│   └── index.html     ← Frontend 3 étapes
├── protected/
│   └── ton_fichier.pdf  ← Place ton fichier ici
└── uploads/           ← Captures temporaires (auto-nettoyé)
```

## Flux complet

1. Client clique "Payer" → téléphone compose le code USSD
2. Client upload la capture d'écran de confirmation
3. **Gemini Flash analyse l'image automatiquement** (1–3 sec)
4. Si paiement valide → téléchargement du fichier
5. Si invalide → client notifié, peut renvoyer une capture

## Déploiement 24h/24 gratuit (Oracle Cloud)

```bash
# Sur ta VM Oracle Free Tier :
sudo apt update && sudo apt install -y nodejs npm
git clone / upload ton projet
npm install
npm install -g pm2

# Lancer avec PM2 (redémarre automatiquement)
GEMINI_API_KEY=AIzaSy... pm2 start server.js --name paiement
pm2 save && pm2 startup
```
