// ========== ПРОСМОТР ПРОФИЛЯ ДРУГОГО ПОЛЬЗОВАТЕЛЯ ==========
const urlParams = new URLSearchParams(window.location.search);
const userId = urlParams.get('id');
if (!userId) window.location.href = 'messenger.html';

document.getElementById('backButton').href = `messenger.html?userId=${userId}`;

let unsubscribePosts = null;

onAuthStateChanged(async (user) => {
  if (!user || !user.emailVerified) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      document.getElementById('profileContent').innerHTML = `
        <div class="error">Пользователь не найден</div>
        <a href="messenger.html" style="display: block; text-align: center; margin-top: 20px; color: #667eea;">Вернуться в мессенджер</a>
      `;
      return;
    }
    const userData = userDoc.data();
    const firstLetter = userData.nickname.charAt(0).toUpperCase();

    document.getElementById('profileContent').innerHTML = `
      <div class="profile-left">
        <div class="profile-card">
          <div class="profile-avatar-placeholder">
            <div class="avatar-large">${firstLetter}</div>
          </div>
          <div class="profile-info">
            <div class="info-row"><label>Никнейм:</label><span>${userData.nickname}</span></div>
            <div class="info-row"><label>Тег:</label><span>${userData.tag}</span></div>
          </div>
        </div>
      </div>
      <div class="profile-right">
        <div class="posts-header"><h2>Посты пользователя</h2></div>
        <div class="posts-container" id="postsContainer"><div class="loading">Загрузка постов...</div></div>
      </div>
    `;

    loadPosts(userId);
  } catch (error) {
    console.error('Ошибка загрузки профиля:', error);
    document.getElementById('profileContent').innerHTML = '<div class="error">Ошибка загрузки профиля</div>';
  }
});

async function loadPosts(targetUserId) {
  const postsContainer = document.getElementById('postsContainer');
  if (unsubscribePosts) unsubscribePosts();

  try {
    unsubscribePosts = db.collection('posts')
      .where('userId', '==', targetUserId)
      .orderBy('createdAt', 'desc')
      .onSnapshot(snapshot => {
        if (snapshot.empty) {
          postsContainer.innerHTML = '<div class="no-posts">У пользователя пока нет постов</div>';
          return;
        }
        let postsHTML = '';
        snapshot.forEach(doc => {
          const post = doc.data();
          let date = 'Дата неизвестна';
          if (post.createdAt) {
            try { date = new Date(post.createdAt.toDate()).toLocaleString(); } catch(e) { date = 'Только что'; }
          }
          postsHTML += `
            <div class="post-card">
              <div class="post-header"><span class="post-date">${date}</span></div>
              <div class="post-content">${post.content ? post.content.replace(/\n/g, '<br>') : ''}</div>
            </div>
          `;
        });
        postsContainer.innerHTML = postsHTML;
      }, error => {
        console.error('Ошибка загрузки постов:', error);
        if (error.code === 'failed-precondition') {
          postsContainer.innerHTML = '<div class="error">Требуется создать индекс. Подождите минуту и обновите страницу.</div>';
        } else {
          postsContainer.innerHTML = '<div class="error">Ошибка загрузки постов</div>';
        }
      });
  } catch (error) {
    console.error('Ошибка:', error);
    postsContainer.innerHTML = '<div class="error">Ошибка загрузки постов</div>';
  }
}