const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // arquivo JSON que você baixa do Firebase Console

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
