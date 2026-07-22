// ========== НАСТРОЙКИ ==========
// Применяем тему из localStorage сразу
(function applyThemeFromLocalStorage() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
    const toggle = document.getElementById('darkThemeToggle');
    if (toggle) toggle.checked = true;
  } else {
    document.body.classList.add('light-theme');
    document.body.classList.remove('dark-theme');
  }
})();

onAuthStateChanged(async (user) => {
  if (!user || !user.emailVerified) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;

  try {
    const doc = await db.collection('users').doc(user.uid).get();
    if (doc.exists) {
      currentUserData = doc.data();
      document.getElementById('userAvatar').textContent = currentUserData.nickname ? currentUserData.nickname.charAt(0).toUpperCase() : '?';
      document.getElementById('userName').textContent = currentUserData.nickname || 'Пользователь';
      document.getElementById('userTag').textContent = currentUserData.tag || '@user';

      if (currentUserData.theme === 'dark') {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
        document.getElementById('darkThemeToggle').checked = true;
        localStorage.setItem('theme', 'dark');
      } else {
        document.body.classList.add('light-theme');
        document.body.classList.remove('dark-theme');
        document.getElementById('darkThemeToggle').checked = false;
        localStorage.setItem('theme', 'light');
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки пользователя:', error);
  }
});

async function toggleTheme(isDark) {
  const theme = isDark ? 'dark' : 'light';
  if (isDark) {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
  } else {
    document.body.classList.add('light-theme');
    document.body.classList.remove('dark-theme');
  }
  localStorage.setItem('theme', theme);

  if (currentUser) {
    try {
      await db.collection('users').doc(currentUser.uid).update({ theme: theme });
    } catch (error) {
      console.error('Ошибка сохранения темы:', error);
    }
  }
}

// logout уже определён в auth.js, но здесь мы его переопределять не будем — используем глобальный