// ========== ПРОФИЛЬ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ ==========
let unsubscribePosts = null;
let isSubmitting = false;
let changes = {};

onAuthStateChanged(async (user) => {
  if (!user || !user.emailVerified) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;
  if (userCache.has(user.uid)) {
    currentUserData = userCache.get(user.uid);
    loadProfileInfo();
    listenForNewPosts();
    return;
  }
  try {
    const doc = await db.collection('users').doc(user.uid).get();
    if (!doc.exists) {
      // Если документа нет – создаём его (для обратной совместимости)
      await db.collection('users').doc(user.uid).set({
        nickname: user.displayName ? user.displayName.split('|')[0] : 'Пользователь',
        tag: user.displayName ? '@' + user.displayName.split('|')[1] : '@user',
        email: user.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // После создания перезагружаем страницу, чтобы данные подтянулись
      window.location.reload();
      return;
    }
    currentUserData = doc.data();
    userCache.set(user.uid, currentUserData);
    document.getElementById('profileAvatar').innerHTML = currentUserData.nickname ? currentUserData.nickname.charAt(0).toUpperCase() : '?';
    loadProfileInfo();
    listenForNewPosts();
  } catch (error) {
    console.error('Ошибка загрузки профиля:', error);
    document.getElementById('profileInfo').innerHTML = '<div class="error">Ошибка загрузки профиля</div>';
  }
});

function loadProfileInfo() {
  const profileInfo = document.getElementById('profileInfo');
  profileInfo.innerHTML = `
    <div class="info-row">
      <label>Никнейм:</label>
      <span id="nickname">${currentUserData.nickname || 'Не указан'}</span>
      <button onclick="editNickname()" class="edit-btn">✎</button>
    </div>
    <div class="info-row">
      <label>Тег:</label>
      <span id="tag">${currentUserData.tag || 'Не указан'}</span>
      <button onclick="editTag()" class="edit-btn">✎</button>
    </div>
    <div class="info-row">
      <label>Email:</label>
      <span>${currentUserData.email}</span>
    </div>
  `;
}

function editNickname() {
  const span = document.getElementById('nickname');
  const current = span.textContent;
  span.innerHTML = `<input type="text" id="editNickname" value="${current}" class="edit-input">`;
  changes.nickname = true;
  if (!document.getElementById('saveProfileBtn')) {
    const saveBtn = document.createElement('button');
    saveBtn.id = 'saveProfileBtn';
    saveBtn.className = 'save-btn';
    saveBtn.textContent = 'Сохранить изменения';
    saveBtn.onclick = saveChanges;
    document.querySelector('.profile-info').appendChild(saveBtn);
  }
}

function editTag() {
  const span = document.getElementById('tag');
  const current = span.textContent;
  span.innerHTML = `<input type="text" id="editTag" value="${current}" placeholder="@tag" class="edit-input">`;
  changes.tag = true;
  if (!document.getElementById('saveProfileBtn')) {
    const saveBtn = document.createElement('button');
    saveBtn.id = 'saveProfileBtn';
    saveBtn.className = 'save-btn';
    saveBtn.textContent = 'Сохранить изменения';
    saveBtn.onclick = saveChanges;
    document.querySelector('.profile-info').appendChild(saveBtn);
  }
}

async function saveChanges() {
  const user = auth.currentUser;
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  const updates = {};
  if (changes.nickname) updates.nickname = document.getElementById('editNickname').value;
  if (changes.tag) updates.tag = document.getElementById('editTag').value;
  try {
    await db.collection('users').doc(user.uid).update(updates);
    const newDisplayName = `${updates.nickname || currentUserData.nickname}|${updates.tag || currentUserData.tag}`;
    await user.updateProfile({ displayName: newDisplayName });
    currentUserData = { ...currentUserData, ...updates };
    userCache.set(user.uid, currentUserData);
    messageDiv.innerHTML = '<div class="success">Изменения сохранены!</div>';
    document.querySelector('.profile-left').appendChild(messageDiv);
    document.getElementById('saveProfileBtn')?.remove();
    changes = {};
    setTimeout(() => messageDiv.remove(), 2000);
  } catch (error) {
    console.error('Ошибка сохранения:', error);
    messageDiv.innerHTML = '<div class="error">Ошибка при сохранении</div>';
    document.querySelector('.profile-left').appendChild(messageDiv);
    setTimeout(() => messageDiv.remove(), 2000);
  }
}

function showCreatePostModal() {
  document.getElementById('postModal').style.display = 'flex';
  document.getElementById('postContent').value = '';
}
function hideCreatePostModal() {
  document.getElementById('postModal').style.display = 'none';
}
async function createPost() {
  if (isSubmitting) return;
  const content = document.getElementById('postContent').value.trim();
  if (!content) { alert('Введите текст поста'); return; }
  hideCreatePostModal();
  isSubmitting = true;
  try {
    await db.collection('posts').add({
      userId: currentUser.uid,
      userNickname: currentUserData.nickname,
      userTag: currentUserData.tag,
      content: content,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Ошибка создания поста:', error);
    alert('Ошибка при создании поста');
  } finally {
    setTimeout(() => { isSubmitting = false; }, 1000);
  }
}
async function deletePost(postId) {
  if (!confirm('Удалить этот пост?')) return;
  try {
    await db.collection('posts').doc(postId).delete();
  } catch (error) {
    console.error('Ошибка удаления поста:', error);
    alert('Ошибка при удалении поста');
  }
}

function listenForNewPosts() {
  if (unsubscribePosts) unsubscribePosts();
  unsubscribePosts = db.collection('posts')
    .where('userId', '==', currentUser.uid)
    .orderBy('createdAt', 'desc')
    .onSnapshot(snapshot => {
      const postsContainer = document.getElementById('postsContainer');
      if (snapshot.empty) {
        postsContainer.innerHTML = '<div class="no-posts">У вас пока нет постов. Создайте первый!</div>';
        return;
      }
      let postsHTML = '';
      snapshot.forEach(doc => {
        const post = doc.data();
        let date = 'Только что';
        if (post.createdAt) {
          try { date = new Date(post.createdAt.toDate()).toLocaleString(); } catch(e) { date = 'Только что'; }
        }
        postsHTML += `
          <div class="post-card" id="post-${doc.id}">
            <div class="post-header">
              <span class="post-date">${date}</span>
              <button onclick="deletePost('${doc.id}')" class="delete-post-btn">×</button>
            </div>
            <div class="post-content">${post.content ? post.content.replace(/\n/g, '<br>') : ''}</div>
          </div>
        `;
      });
      postsContainer.innerHTML = postsHTML;
    }, error => { console.error('Ошибка в слушателе постов:', error); });
}

window.onclick = function(event) {
  const modal = document.getElementById('postModal');
  if (event.target === modal) modal.style.display = 'none';
};