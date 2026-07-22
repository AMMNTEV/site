// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
window.userCache = new Map();
let currentUser = null;
let currentUserData = null;

// ========== ФУНКЦИЯ ДЛЯ ОБРАБОТКИ СОСТОЯНИЯ АВТОРИЗАЦИИ ==========
function onAuthStateChanged(callback) {
  auth.onAuthStateChanged(async (user) => {
    if (user && user.emailVerified) {
      currentUser = user;
      try {
        const doc = await db.collection('users').doc(user.uid).get();
        currentUserData = doc.exists ? doc.data() : null;
      } catch (err) {
        console.error('Ошибка загрузки данных пользователя:', err);
        currentUserData = null;
      }
      if (callback) callback(user, currentUserData);
    } else {
      currentUser = null;
      currentUserData = null;
      if (callback) callback(null, null);
    }
  });
}

// ========== ФУНКЦИИ АВТОРИЗАЦИИ ==========
async function login(email, password) {
  return auth.signInWithEmailAndPassword(email, password);
}

async function register(email, password, nickname, tag) {
  const userCredential = await auth.createUserWithEmailAndPassword(email, password);
  const user = userCredential.user;
  await user.updateProfile({ displayName: nickname + '|' + tag });
  await user.sendEmailVerification({ url: window.location.origin + '/index.html' });
  await auth.signOut();
  return user;
}

async function resetPassword(email) {
  return auth.sendPasswordResetEmail(email);
}

async function sendVerificationEmail() {
  const user = auth.currentUser;
  if (user) {
    await user.sendEmailVerification();
    return user;
  }
  throw new Error('No user logged in');
}

async function logout() {
  await auth.signOut();
  window.location.href = 'index.html';
}

// ========== ПРОВЕРКА УНИКАЛЬНОСТИ ТЕГА ==========
async function checkTagUnique(tag) {
  const fullTag = '@' + tag;
  const snapshot = await db.collection('users').where('tag', '==', fullTag).get();
  return snapshot.empty;
}

// ========== УТИЛИТЫ ДЛЯ ТЕГА ==========
function handleTagInput(input) {
  let value = input.value.replace(/@/g, '').slice(0, 20);
  value = value.replace(/[^a-zA-Z0-9_]/g, '');
  input.value = value;
}

function preventAtSymbolDeletion(event, input) {
  if (event.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0) {
    event.preventDefault();
  }
  if (event.key === 'Delete' && input.selectionStart === 0 && input.selectionEnd === 1) {
    event.preventDefault();
  }
  if (event.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
    event.preventDefault();
  }
}