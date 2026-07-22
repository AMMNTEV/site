// Конфигурация Firebase - замените на свои данные из консоли Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAqzIbV2Uly03MbjpyNP9RQQx-0uDYnJdY",
  authDomain: "yttg-3b587.firebaseapp.com",
  projectId: "yttg-3b587",
  storageBucket: "yttg-3b587.firebasestorage.app",
  messagingSenderId: "77409665832",
  appId: "1:77409665832:web:b63c780592b3dfc82a061d",
  measurementId: "G-5VHQ23S2PP"
};

// Инициализация Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Включаем постоянное сохранение сессии
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .then(() => console.log('✅ Сессия будет сохраняться постоянно'))
  .catch((error) => console.log('❌ Ошибка настройки сессии:', error));

// Настройка Firestore для работы оффлайн (кеширование данных)
db.enablePersistence()
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      console.log('⚠️ Несколько вкладок открыто, persistence работает в ограниченном режиме');
    } else if (err.code === 'unimplemented') {
      console.log('⚠️ Браузер не поддерживает persistence');
    }
  });