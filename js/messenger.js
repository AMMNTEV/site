// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let selectedChat = null;
let currentChatId = null;
let unsubscribeMessages = null;
let unsubscribeChats = null;
let allChats = [];
let allUsers = [];
let allUsersForModal = [];
let isChatMode = false;
let selectedMessageId = null;
let unreadCounts = {};
let isCreatingGroup = false;
let isNewChatPending = false;

// Ключи для localStorage
const CACHE_CHATS_KEY = 'messenger_chats_cache';
const CACHE_USERS_KEY = 'messenger_users_cache';
const CACHE_UNREAD_KEY = 'messenger_unread_cache';

// ========== СОХРАНЕНИЕ КЭША ==========
function saveCache() {
  if (!currentUser) return;
  try {
    localStorage.setItem(CACHE_CHATS_KEY, JSON.stringify({
      uid: currentUser.uid,
      data: allChats,
      timestamp: Date.now()
    }));
    localStorage.setItem(CACHE_UNREAD_KEY, JSON.stringify(unreadCounts));
  } catch (e) {
    console.warn('Ошибка сохранения кэша:', e);
  }
}

// ========== ЗАГРУЗКА КЭША (СИНХРОННО) ==========
function loadCachedChats() {
  if (!currentUser) return false;
  const cachedChats = localStorage.getItem(CACHE_CHATS_KEY);
  if (cachedChats) {
    try {
      const parsed = JSON.parse(cachedChats);
      if (parsed.uid === currentUser.uid && parsed.data) {
        allChats = parsed.data;
        const cachedUnread = localStorage.getItem(CACHE_UNREAD_KEY);
        if (cachedUnread) {
          unreadCounts = JSON.parse(cachedUnread);
        }
        displayChats(allChats);
        return true;
      }
    } catch (e) { /* игнорируем */ }
  }
  return false;
}

// ========== ЗАГРУЗКА ПОЛЬЗОВАТЕЛЕЙ (с кэшем) ==========
async function loadAllUsers(force = false) {
  if (!currentUser) return;
  try {
    if (!force) {
      const cached = localStorage.getItem(CACHE_USERS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.uid === currentUser.uid && parsed.data) {
          allUsers = parsed.data;
          return;
        }
      }
    }

    const snapshot = await db.collection('users').get();
    allUsers = [];
    snapshot.forEach(doc => {
      if (doc.id !== currentUser.uid) {
        allUsers.push({ id: doc.id, ...doc.data() });
      }
    });

    localStorage.setItem(CACHE_USERS_KEY, JSON.stringify({
      uid: currentUser.uid,
      data: allUsers,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.error('Ошибка загрузки пользователей:', error);
  }
}

// ========== ЗАГРУЗКА ПОЛЬЗОВАТЕЛЕЙ ДЛЯ МОДАЛКИ ==========
async function loadAllUsersForModal() {
  allUsersForModal = allUsers.filter(u => u.id !== currentUser.uid);
}

// ========== ПОЛУЧЕНИЕ ПОЛЬЗОВАТЕЛЯ ПО ID ==========
async function getUserById(userId) {
  if (userCache.has(userId)) return userCache.get(userId);
  const found = allUsers.find(u => u.id === userId);
  if (found) {
    userCache.set(userId, found);
    return found;
  }
  try {
    const doc = await db.collection('users').doc(userId).get();
    const data = doc.exists ? doc.data() : null;
    if (data) {
      userCache.set(userId, data);
      if (!allUsers.find(u => u.id === userId)) {
        allUsers.push({ id: userId, ...data });
      }
    }
    return data;
  } catch (error) {
    console.error('Ошибка загрузки пользователя:', error);
    return null;
  }
}

// ========== ПРОСЛУШИВАНИЕ ЧАТОВ (с кэшем) ==========
function listenForChats() {
  if (!currentUser) return;
  if (unsubscribeChats) unsubscribeChats();

  // Если кэш ещё не был показан, показываем его сейчас
  // (на случай, если loadCachedChats не сработал)
  const cachedChats = localStorage.getItem(CACHE_CHATS_KEY);
  if (cachedChats) {
    try {
      const parsed = JSON.parse(cachedChats);
      if (parsed.uid === currentUser.uid && parsed.data && allChats.length === 0) {
        allChats = parsed.data;
        const cachedUnread = localStorage.getItem(CACHE_UNREAD_KEY);
        if (cachedUnread) {
          unreadCounts = JSON.parse(cachedUnread);
        }
        displayChats(allChats);
      }
    } catch (e) { /* игнорируем */ }
  }

  // Подписываемся на реальные изменения
  unsubscribeChats = db.collection('chats')
    .where('participants', 'array-contains', currentUser.uid)
    .onSnapshot(snapshot => {
      const chatsList = document.getElementById('chatsList');
      if (!chatsList) return;

      if (snapshot.empty) {
        chatsList.innerHTML = '<div class="no-chats">У вас пока нет чатов. Найдите пользователя через поиск.</div>';
        allChats = [];
        localStorage.removeItem(CACHE_CHATS_KEY);
        if (!isNewChatPending) {
          displayChats(allChats);
        }
        return;
      }

      const chatPromises = [];
      const chats = [];
      const newUnreadCounts = {};

      snapshot.forEach(doc => {
        const chat = doc.data();
        const promise = (async () => {
          let chatName = '';
          let chatAvatar = '';
          let createdAt = chat.createdAt ? chat.createdAt.toDate?.() || new Date(chat.createdAt) : new Date();

          if (chat.isGroup) {
            chatName = chat.name || 'Беседа';
            chatAvatar = '👥';
          } else {
            const otherUserId = chat.participants.find(id => id !== currentUser.uid);
            const otherUser = await getUserById(otherUserId);
            chatName = otherUser ? otherUser.nickname : 'Пользователь';
            chatAvatar = otherUser ? otherUser.tag : '';
          }

          const lastMsgQuery = await db.collection('chats').doc(doc.id)
            .collection('messages')
            .orderBy('timestamp', 'desc')
            .limit(5)
            .get();

          let lastMessage = null;
          let lastMessageTime = chat.lastMessageTime ? chat.lastMessageTime.toDate?.() || new Date(chat.lastMessageTime) : null;
          let hasAnyMessage = false;

          for (const msgDoc of lastMsgQuery.docs) {
            const msg = msgDoc.data();
            hasAnyMessage = true;
            if (!msg.deletedFor || (!msg.deletedFor.includes('everyone') && !msg.deletedFor.includes(currentUser.uid))) {
              lastMessage = msg.text;
              lastMessageTime = msg.timestamp ? msg.timestamp.toDate?.() || new Date(msg.timestamp) : lastMessageTime;
              break;
            }
          }

          if (!chat.isGroup && !hasAnyMessage) return;

          if (!lastMessageTime) {
            lastMessageTime = createdAt;
          }

          let unreadCount = 0;
          if (chat.isGroup) {
            const messagesSnapshot = await db.collection('chats').doc(doc.id)
              .collection('messages')
              .orderBy('timestamp', 'desc')
              .limit(50)
              .get();
            messagesSnapshot.forEach(msgDoc => {
              const msg = msgDoc.data();
              if (msg.deletedFor && (msg.deletedFor.includes('everyone') || msg.deletedFor.includes(currentUser.uid))) return;
              if (msg.isSystem) return;
              if (msg.senderId !== currentUser.uid && (!msg.readBy || !msg.readBy.includes(currentUser.uid))) {
                unreadCount++;
              }
            });
          } else {
            const unreadQuery = await db.collection('chats').doc(doc.id)
              .collection('messages')
              .where('read', '==', false)
              .get();
            unreadQuery.forEach(msgDoc => {
              const msg = msgDoc.data();
              if (msg.deletedFor && (msg.deletedFor.includes('everyone') || msg.deletedFor.includes(currentUser.uid))) return;
              if (msg.receiverId === currentUser.uid) unreadCount++;
            });
          }

          newUnreadCounts[doc.id] = unreadCount;

          chats.push({
            id: doc.id,
            ...chat,
            displayName: chatName,
            displayAvatar: chatAvatar,
            lastMessage: lastMessage,
            lastMessageTime: lastMessageTime,
            createdAt: createdAt
          });
        })();
        chatPromises.push(promise);
      });

      Promise.all(chatPromises).then(() => {
        const filteredChats = chats.filter(chat => chat !== undefined);
        unreadCounts = newUnreadCounts;
        allChats = filteredChats;
        allChats.sort((a, b) => {
          const unreadA = unreadCounts[a.id] || 0;
          const unreadB = unreadCounts[b.id] || 0;
          if (unreadB !== unreadA) return unreadB - unreadA;
          const timeA = a.lastMessageTime || a.createdAt || new Date(0);
          const timeB = b.lastMessageTime || b.createdAt || new Date(0);
          return timeB - timeA;
        });

        // Сохраняем кэш после обновления
        saveCache();

        if (!isNewChatPending) {
          displayChats(allChats);
        } else {
          const newChat = allChats.find(c => c.id === currentChatId);
          if (newChat && selectedChat && selectedChat.isNew) {
            selectedChat = newChat;
            selectedChat.isNew = false;
            isNewChatPending = false;
            updateChatHeader(selectedChat);
            loadMessages(false);
          }
        }
      });
    }, error => console.error('Ошибка прослушивания чатов:', error));
}

// ========== ОТОБРАЖЕНИЕ СПИСКА ЧАТОВ ==========
function displayChats(chats) {
  const chatsList = document.getElementById('chatsList');
  chatsList.innerHTML = chats.map(chat => {
    const unreadCount = unreadCounts[chat.id] || 0;
    const unreadBadge = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : '';
    let avatarContent = chat.isGroup ? '👥 ' + (chat.displayName ? chat.displayName.charAt(0).toUpperCase() : '?') : (chat.displayName ? chat.displayName.charAt(0).toUpperCase() : '?');
    const lastMessage = chat.lastMessage || 'Нет сообщений';
    const chatJson = JSON.stringify(chat).replace(/'/g, "\\'").replace(/"/g, '&quot;');
    return `
      <div class="chat-item ${unreadCount > 0 ? 'has-unread' : ''}" onclick='selectChat(${chatJson})'>
        <div class="chat-avatar-placeholder">${avatarContent}</div>
        <div class="chat-info">
          <div class="chat-name">${chat.displayName} ${unreadBadge}</div>
          <div class="chat-last-message">${lastMessage.length > 30 ? lastMessage.substring(0, 30) + '...' : lastMessage}</div>
        </div>
      </div>
    `;
  }).join('');

  // Сохраняем кэш при каждой отрисовке
  saveCache();

  const searchInput = document.getElementById('searchInput');
  if (searchInput && searchInput.value.trim() !== '') {
    searchAll();
  }
}

// ========== ПОИСК ==========
function searchAll() {
  const searchText = document.getElementById('searchInput').value.toLowerCase();
  if (!searchText) { displayChats(allChats); return; }

  const filteredUsers = allUsers.filter(user =>
    (user.nickname && user.nickname.toLowerCase().includes(searchText)) ||
    (user.tag && user.tag.toLowerCase().includes(searchText))
  );
  const filteredChats = allChats.filter(chat =>
    chat.isGroup && chat.displayName.toLowerCase().includes(searchText)
  );

  if (filteredUsers.length === 0 && filteredChats.length === 0) {
    document.getElementById('chatsList').innerHTML = '<div class="no-users">Ничего не найдено</div>';
    return;
  }

  let resultsHTML = '';
  if (filteredChats.length > 0) {
    resultsHTML += '<div class="search-section"><h4>Беседы:</h4></div>';
    filteredChats.forEach(chat => {
      const avatarContent = '👥 ' + (chat.displayName.charAt(0).toUpperCase() || '?');
      const chatJson = JSON.stringify(chat).replace(/'/g, "\\'").replace(/"/g, '&quot;');
      resultsHTML += `
        <div class="chat-item" onclick='selectChat(${chatJson})'>
          <div class="chat-avatar-placeholder">${avatarContent}</div>
          <div class="chat-info">
            <div class="chat-name">${chat.displayName}</div>
            <div class="chat-last-message">Беседа</div>
          </div>
        </div>
      `;
    });
  }
  if (filteredUsers.length > 0) {
    resultsHTML += '<div class="search-section"><h4>Пользователи:</h4></div>';
    filteredUsers.forEach(user => {
      const firstLetter = user.nickname ? user.nickname.charAt(0).toUpperCase() : '?';
      const tag = user.tag || '';
      const nickname = user.nickname || 'Без имени';
      resultsHTML += `
        <div class="user-item" onclick="createPrivateChat('${user.id}', '${nickname.replace(/'/g, "\\'")}', '${tag.replace(/'/g, "\\'")}')">
          <div class="user-avatar-placeholder">${firstLetter}</div>
          <div class="user-info">
            <div class="user-name">${nickname}</div>
            <div class="user-tag">${tag}</div>
          </div>
        </div>
      `;
    });
  }
  document.getElementById('chatsList').innerHTML = resultsHTML;
}

// ========== ПОИСК В МОДАЛКАХ ==========
function searchUsersInCreate() {
  const searchText = document.getElementById('searchUsersInCreate').value.toLowerCase();
  const usersList = document.getElementById('usersListModal');
  if (!searchText) { usersList.innerHTML = '<div class="no-users">Начните вводить имя для поиска</div>'; return; }
  const filtered = allUsersForModal.filter(user =>
    (user.nickname && user.nickname.toLowerCase().includes(searchText)) ||
    (user.tag && user.tag.toLowerCase().includes(searchText))
  );
  if (filtered.length === 0) { usersList.innerHTML = '<div class="no-users">Ничего не найдено</div>'; return; }
  let html = '';
  filtered.forEach(user => {
    html += `<label class="user-checkbox"><input type="checkbox" value="${user.id}"><span>${user.nickname} ${user.tag}</span></label>`;
  });
  usersList.innerHTML = html;
}

function searchUsersToAdd() {
  if (!selectedChat) return;
  const searchText = document.getElementById('searchUsersToAdd').value.toLowerCase();
  const addList = document.getElementById('addParticipantsList');
  if (!searchText) { addList.innerHTML = '<div class="no-users">Начните вводить имя для поиска</div>'; return; }
  const nonParticipants = allUsersForModal.filter(user => !selectedChat.participants.includes(user.id));
  const filtered = nonParticipants.filter(user =>
    (user.nickname && user.nickname.toLowerCase().includes(searchText)) ||
    (user.tag && user.tag.toLowerCase().includes(searchText))
  );
  if (filtered.length === 0) { addList.innerHTML = '<div class="no-users">Ничего не найдено</div>'; return; }
  let html = '';
  filtered.forEach(user => {
    html += `<label class="user-checkbox"><input type="checkbox" value="${user.id}"><span>${user.nickname} ${user.tag}</span></label>`;
  });
  addList.innerHTML = html;
}

// ========== СОЗДАНИЕ ЛИЧНОГО ЧАТА ==========
async function createPrivateChat(userId, nickname, tag) {
  try {
    const chatsSnapshot = await db.collection('chats')
      .where('participants', 'array-contains', currentUser.uid)
      .get();
    let existingChatId = null;
    let existingChat = null;
    chatsSnapshot.forEach(doc => {
      const chat = doc.data();
      if (!chat.isGroup && chat.participants.includes(userId)) {
        existingChatId = doc.id;
        existingChat = { id: doc.id, ...chat };
      }
    });
    if (existingChatId) {
      const chat = { id: existingChatId, ...existingChat, displayName: nickname, displayAvatar: tag };
      selectChat(chat);
    } else {
      const virtualChat = {
        id: 'new_' + userId,
        participants: [currentUser.uid, userId],
        isGroup: false,
        displayName: nickname,
        displayAvatar: tag,
        isNew: true,
        lastMessage: null,
        lastMessageTime: null
      };
      isNewChatPending = true;
      selectChat(virtualChat);
    }
  } catch (error) {
    console.error('Ошибка создания чата:', error);
    alert('Ошибка при создании чата');
  }
}

// ========== ВЫБОР ЧАТА ==========
async function selectChat(chat) {
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }

  const messagesContainer = document.getElementById('messagesContainer');
  const chatHeader = document.getElementById('chatHeader');

  if (chat.isNew) {
    selectedChat = chat;
    currentChatId = chat.id;
    updateChatHeader(chat);
    messagesContainer.innerHTML = '<div class="no-messages">Нет сообщений. Напишите что-нибудь!</div>';
    document.getElementById('messageInputArea').style.display = 'flex';
    if (window.innerWidth <= 768) {
      enterChatMode();
    }
    return;
  }

  selectedChat = chat;
  currentChatId = chat.id;
  messagesContainer.innerHTML = '<div class="loading">Загрузка сообщений...</div>';
  updateChatHeader(chat);
  document.getElementById('messageInputArea').style.display = 'flex';

  await loadMessages(true);

  if (window.innerWidth <= 768) {
    enterChatMode();
  }

  if (unreadCounts[chat.id] > 0) {
    markMessagesAsRead(chat.id);
  }
}

// ========== ОБНОВЛЕНИЕ ШАПКИ ЧАТА ==========
function updateChatHeader(chat) {
  const chatHeader = document.getElementById('chatHeader');
  let headerContent = '';
  if (chat.isGroup) {
    const participantsCount = chat.participants ? chat.participants.length : 2;
    headerContent = `
      <div class="selected-chat" onclick="openChatInfo('${chat.id}')">
        <button class="mobile-back-btn" onclick="event.stopPropagation(); exitChatMode()"><</button>
        <div class="chat-avatar-placeholder large">👥 ${chat.displayName.charAt(0).toUpperCase()}</div>
        <div class="chat-info">
          <h3>${chat.displayName}</h3>
          <p>${participantsCount} участников</p>
        </div>
      </div>
    `;
  } else {
    const otherUserId = chat.participants.find(id => id !== currentUser.uid);
    headerContent = `
      <div class="selected-chat" onclick="openUserProfile('${otherUserId}')">
        <button class="mobile-back-btn" onclick="event.stopPropagation(); exitChatMode()"><</button>
        <div class="chat-avatar-placeholder large">${chat.displayName.charAt(0).toUpperCase()}</div>
        <div class="chat-info">
          <h3>${chat.displayName}</h3>
          <p>${chat.displayAvatar}</p>
        </div>
      </div>
    `;
  }
  chatHeader.innerHTML = headerContent;
}

// ========== ОТМЕТКА ПРОЧИТАННЫХ ==========
async function markMessagesAsRead(chatId) {
  if (selectedChat && selectedChat.isGroup) return;
  try {
    const unreadSnapshot = await db.collection('chats').doc(chatId)
      .collection('messages')
      .where('read', '==', false)
      .get();
    if (unreadSnapshot.empty) return;
    const batch = db.batch();
    unreadSnapshot.forEach(doc => {
      const msg = doc.data();
      if (msg.receiverId === currentUser.uid) {
        batch.update(doc.ref, { read: true });
      }
    });
    await batch.commit();
    unreadCounts[chatId] = 0;
    saveCache(); // сохраняем кэш
    const chatElement = document.querySelector(`.chat-item[onclick*='${chatId}']`);
    if (chatElement) {
      chatElement.classList.remove('has-unread');
      const nameElement = chatElement.querySelector('.chat-name');
      if (nameElement) {
        const badge = nameElement.querySelector('.unread-badge');
        if (badge) badge.remove();
      }
    }
  } catch (error) {
    console.error('Ошибка при отметке сообщений как прочитанных:', error);
  }
}

// ========== ЗАГРУЗКА СООБЩЕНИЙ (с кэшем Firestore) ==========
async function loadMessages(showLoading = false) {
  if (!currentChatId || !selectedChat) return;
  const messagesContainer = document.getElementById('messagesContainer');
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }

  if (showLoading) {
    messagesContainer.innerHTML = '<div class="loading">Загрузка сообщений...</div>';
  }

  // Сначала пробуем кэш Firestore, затем сервер
  let snapshot;
  try {
    snapshot = await db.collection('chats').doc(currentChatId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .get({ source: 'cache' });
  } catch (e) {
    snapshot = null;
  }

  if (!snapshot || snapshot.empty) {
    try {
      snapshot = await db.collection('chats').doc(currentChatId)
        .collection('messages')
        .orderBy('timestamp', 'asc')
        .get({ source: 'server' });
    } catch (error) {
      console.error('Ошибка загрузки сообщений:', error);
      if (showLoading) {
        messagesContainer.innerHTML = '<div class="error">Ошибка загрузки сообщений</div>';
      }
      return;
    }
  }

  const visibleMessages = [];
  snapshot.forEach(doc => {
    const msg = doc.data();
    if (msg.deletedFor && (msg.deletedFor.includes('everyone') || msg.deletedFor.includes(currentUser.uid))) {
      return;
    }
    visibleMessages.push({ id: doc.id, ...msg });
  });

  const scrollTop = messagesContainer.scrollTop;

  if (visibleMessages.length === 0) {
    messagesContainer.innerHTML = '<div class="no-messages">Нет сообщений. Напишите что-нибудь!</div>';
    return;
  }

  // Загружаем отправителей для групповых чатов
  const senderIds = new Set();
  visibleMessages.forEach(msg => {
    if (!msg.isSystem && selectedChat.isGroup && msg.senderId !== currentUser.uid) {
      senderIds.add(msg.senderId);
    }
  });

  const senderCache = {};
  if (senderIds.size > 0) {
    const userIds = Array.from(senderIds);
    for (let i = 0; i < userIds.length; i += 10) {
      const batch = userIds.slice(i, i + 10);
      const usersSnapshot = await db.collection('users')
        .where('__name__', 'in', batch)
        .get();
      usersSnapshot.forEach(doc => {
        senderCache[doc.id] = doc.data();
      });
    }
  }

  // Отмечаем непрочитанные
  const batch = db.batch();
  let hasUnread = false;
  visibleMessages.forEach(msg => {
    if (selectedChat.isGroup) {
      if (msg.senderId !== currentUser.uid && !msg.isSystem) {
        if (!msg.readBy || !msg.readBy.includes(currentUser.uid)) {
          hasUnread = true;
          batch.update(db.collection('chats').doc(currentChatId).collection('messages').doc(msg.id), {
            readBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
          });
        }
      }
    } else {
      if (msg.receiverId === currentUser.uid && !msg.read) {
        hasUnread = true;
        batch.update(db.collection('chats').doc(currentChatId).collection('messages').doc(msg.id), { read: true });
      }
    }
  });
  if (hasUnread) {
    await batch.commit();
    unreadCounts[currentChatId] = 0;
    saveCache();
    const chatElement = document.querySelector(`.chat-item[onclick*='${currentChatId}']`);
    if (chatElement) {
      chatElement.classList.remove('has-unread');
      const nameElement = chatElement.querySelector('.chat-name');
      if (nameElement) {
        const badge = nameElement.querySelector('.unread-badge');
        if (badge) badge.remove();
      }
    }
  }

  // Строим HTML
  let html = '';
  let lastDate = '';
  const nonSystemMessages = visibleMessages.filter(msg => !msg.isSystem);
  if (nonSystemMessages.length === 0) {
    visibleMessages.forEach(msg => {
      if (msg.isSystem) {
        html += `<div class="message system"><div class="message-content">${msg.text}</div></div>`;
      }
    });
  } else {
    visibleMessages.forEach(msg => {
      const isMyMessage = msg.senderId === currentUser.uid;
      let time = '';
      let messageDate = '';
      if (msg.timestamp) {
        const date = msg.timestamp.toDate();
        time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageDate = date.toLocaleDateString();
      }
      if (!msg.isSystem && messageDate && messageDate !== lastDate) {
        html += `<div class="date-separator">${messageDate}</div>`;
        lastDate = messageDate;
      }
      if (msg.isSystem) {
        html += `<div class="message system"><div class="message-content">${msg.text}</div></div>`;
        return;
      }
      let senderInfo = '';
      if (selectedChat.isGroup && !isMyMessage) {
        const sender = senderCache[msg.senderId];
        if (sender) {
          senderInfo = `<div class="message-sender">${sender.nickname || '?'} ${sender.tag || ''}</div>`;
        }
      }
      const deleteOption = isMyMessage ? `<button class="message-delete-btn" onclick="showMessageOptions('${msg.id}', event)">⋯</button>` : '';
      html += `
        <div class="message ${isMyMessage ? 'my-message' : 'other-message'}" id="msg-${msg.id}">
          ${deleteOption}
          ${senderInfo}
          <div class="message-content">${msg.text.replace(/\n/g, '<br>')}</div>
          <div class="message-time">${time}</div>
        </div>
      `;
    });
  }

  messagesContainer.innerHTML = html;
  if (scrollTop > 0) {
    messagesContainer.scrollTop = scrollTop;
  } else {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  listenForNewMessages();
}

// ========== СЛУШАТЕЛЬ НОВЫХ СООБЩЕНИЙ ==========
function listenForNewMessages() {
  if (!currentChatId) return;
  if (unsubscribeMessages) {
    unsubscribeMessages();
  }
  const lastTimestamp = firebase.firestore.Timestamp.now();

  unsubscribeMessages = db.collection('chats').doc(currentChatId)
    .collection('messages')
    .where('timestamp', '>', lastTimestamp)
    .orderBy('timestamp', 'asc')
    .onSnapshot(async snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          const msg = change.doc.data();
          const msgId = change.doc.id;
          if (document.getElementById(`msg-${msgId}`)) return;

          if (selectedChat.isGroup) {
            if (msg.senderId !== currentUser.uid && !msg.isSystem) {
              if (!msg.readBy || !msg.readBy.includes(currentUser.uid)) {
                await change.doc.ref.update({ readBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid) });
              }
            }
          } else {
            if (msg.receiverId === currentUser.uid && !msg.read) {
              await change.doc.ref.update({ read: true });
            }
          }

          let senderInfo = '';
          if (selectedChat.isGroup && msg.senderId !== currentUser.uid && msg.senderId) {
            const sender = await getUserById(msg.senderId);
            if (sender) {
              senderInfo = `<div class="message-sender">${sender.nickname || '?'} ${sender.tag || ''}</div>`;
            }
          }
          const isMyMessage = msg.senderId === currentUser.uid;
          let time = '';
          if (msg.timestamp) {
            const date = msg.timestamp.toDate();
            time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }
          const deleteOption = isMyMessage ? `<button class="message-delete-btn" onclick="showMessageOptions('${msgId}', event)">⋯</button>` : '';
          const messageHTML = `
            <div class="message ${isMyMessage ? 'my-message' : 'other-message'}" id="msg-${msgId}">
              ${deleteOption}
              ${senderInfo}
              <div class="message-content">${msg.text.replace(/\n/g, '<br>')}</div>
              <div class="message-time">${time}</div>
            </div>
          `;
          const messagesContainer = document.getElementById('messagesContainer');
          messagesContainer.insertAdjacentHTML('beforeend', messageHTML);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      });
    }, error => console.error('Ошибка слушателя новых сообщений:', error));
}

// ========== ОТПРАВКА СООБЩЕНИЯ ==========
async function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text || !selectedChat) return;
  input.value = '';

  try {
    if (selectedChat.isNew) {
      const otherUserId = selectedChat.participants.find(id => id !== currentUser.uid);
      const newChatRef = await db.collection('chats').add({
        participants: [currentUser.uid, otherUserId],
        isGroup: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastMessage: null,
        lastMessageTime: null
      });
      const chatId = newChatRef.id;
      selectedChat.id = chatId;
      selectedChat.isNew = false;
      currentChatId = chatId;
      isNewChatPending = false;

      const messageData = {
        text: text,
        senderId: currentUser.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        receiverId: otherUserId,
        read: false
      };
      await db.collection('chats').doc(chatId).collection('messages').add(messageData);
      await db.collection('chats').doc(chatId).update({
        lastMessage: text,
        lastMessageTime: firebase.firestore.FieldValue.serverTimestamp()
      });

      await loadMessages(false);
      updateChatHeader(selectedChat);
      saveCache();
      return;
    }

    const messageData = {
      text: text,
      senderId: currentUser.uid,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (selectedChat.isGroup) {
      messageData.readBy = [currentUser.uid];
    } else {
      const otherUserId = selectedChat.participants.find(id => id !== currentUser.uid);
      messageData.receiverId = otherUserId;
      messageData.read = false;
    }

    await db.collection('chats').doc(currentChatId).collection('messages').add(messageData);
    await db.collection('chats').doc(currentChatId).update({
      lastMessage: text,
      lastMessageTime: firebase.firestore.FieldValue.serverTimestamp()
    });

    await loadMessages(false);
    saveCache();

  } catch (error) {
    console.error('Ошибка отправки:', error);
    alert('Ошибка при отправке сообщения');
    input.value = text;
  }
}

// ========== СОЗДАНИЕ ГРУППЫ ==========
function showCreateGroupModal() {
  const usersList = document.getElementById('usersListModal');
  if (!usersList) return;
  document.getElementById('searchUsersInCreate').value = '';
  usersList.innerHTML = '<div class="no-users">Начните вводить имя для поиска</div>';
  document.getElementById('createGroupModal').style.display = 'flex';
}
function hideCreateGroupModal() {
  document.getElementById('createGroupModal').style.display = 'none';
}
async function createGroupChat() {
  if (isCreatingGroup) return;
  const groupName = document.getElementById('groupName').value.trim();
  const checkboxes = document.querySelectorAll('#usersListModal input[type="checkbox"]:checked');
  if (!groupName) { alert('Введите название беседы'); return; }
  if (checkboxes.length === 0) { alert('Выберите хотя бы одного участника'); return; }
  isCreatingGroup = true;
  hideCreateGroupModal();
  const participants = [currentUser.uid];
  checkboxes.forEach(cb => participants.push(cb.value));
  try {
    await db.collection('chats').add({
      name: groupName,
      participants: participants,
      isGroup: true,
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessage: null,
      lastMessageTime: null
    });
    document.getElementById('groupName').value = '';
  } catch (error) {
    console.error('Ошибка создания беседы:', error);
    alert('Ошибка при создании беседы: ' + error.message);
  } finally {
    setTimeout(() => { isCreatingGroup = false; }, 1000);
  }
}

// ========== ИНФОРМАЦИЯ О ГРУППЕ ==========
async function openChatInfo(chatId) {
  if (!selectedChat || !selectedChat.isGroup) return;
  try {
    const chatDoc = await db.collection('chats').doc(chatId).get();
    const chat = chatDoc.data();
    selectedChat = { ...selectedChat, participants: chat.participants, name: chat.name };

    let participantsHTML = '<ul class="participants-list">';
    for (const userId of chat.participants) {
      const userData = await getUserById(userId);
      if (userData) {
        const isCreator = userId === chat.createdBy ? ' (создатель)' : '';
        const canRemove = userId !== currentUser.uid && userId !== chat.createdBy;
        participantsHTML += `<li>
          ${userData.nickname} ${userData.tag}${isCreator}
          ${canRemove ? `<button class="remove-participant-btn" onclick="removeParticipant('${userId}')">×</button>` : ''}
        </li>`;
      }
    }
    participantsHTML += '</ul>';

    document.getElementById('groupInfoName').textContent = chat.name || 'Беседа';
    document.getElementById('groupParticipants').innerHTML = participantsHTML;

    const leaveBtn = document.getElementById('leaveGroupBtn');
    if (chat.createdBy === currentUser.uid) {
      leaveBtn.style.display = 'none';
    } else {
      leaveBtn.style.display = 'block';
    }

    document.getElementById('searchUsersToAdd').value = '';
    document.getElementById('addParticipantsList').innerHTML = '<div class="no-users">Начните вводить имя для поиска</div>';

    const deleteBtn = document.getElementById('deleteGroupBtn');
    if (chat.createdBy === currentUser.uid) {
      deleteBtn.style.display = 'inline-block';
    } else {
      deleteBtn.style.display = 'none';
    }

    document.getElementById('groupInfoModal').style.display = 'flex';
  } catch (error) {
    console.error('Ошибка загрузки информации о беседе:', error);
  }
}
function hideGroupInfoModal() {
  document.getElementById('groupInfoModal').style.display = 'none';
}

// ========== УПРАВЛЕНИЕ УЧАСТНИКАМИ ГРУППЫ ==========
async function removeParticipant(userId) {
  if (!selectedChat || !selectedChat.isGroup) return;
  if (!confirm('Удалить этого участника из беседы?')) return;
  try {
    await db.collection('chats').doc(selectedChat.id).update({
      participants: firebase.firestore.FieldValue.arrayRemove(userId)
    });
    const userData = await getUserById(userId);
    if (userData) {
      await db.collection('chats').doc(selectedChat.id)
        .collection('messages')
        .add({
          text: `❌ ${userData.nickname} ${userData.tag} удален из беседы`,
          senderId: 'system',
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          read: false,
          isSystem: true
        });
    }
    const updatedChatDoc = await db.collection('chats').doc(selectedChat.id).get();
    const updatedChat = updatedChatDoc.data();
    selectedChat = { ...selectedChat, participants: updatedChat.participants };
    await openChatInfo(selectedChat.id);
    updateChatHeaderParticipantCount();
    if (unsubscribeChats) { unsubscribeChats(); }
    listenForChats();
  } catch (error) {
    console.error('Ошибка удаления участника:', error);
    alert('Ошибка при удалении участника');
  }
}

async function addSelectedParticipants() {
  if (!selectedChat) return;
  const checkboxes = document.querySelectorAll('#addParticipantsList input[type="checkbox"]:checked');
  if (checkboxes.length === 0) { alert('Выберите пользователей для добавления'); return; }
  const newParticipants = [];
  checkboxes.forEach(cb => newParticipants.push(cb.value));
  try {
    await db.collection('chats').doc(selectedChat.id).update({
      participants: firebase.firestore.FieldValue.arrayUnion(...newParticipants)
    });
    const addedNames = [];
    for (const userId of newParticipants) {
      const userData = await getUserById(userId);
      if (userData) {
        addedNames.push(`${userData.nickname} ${userData.tag}`);
      }
    }
    await db.collection('chats').doc(selectedChat.id)
      .collection('messages')
      .add({
        text: `✅ Добавлены: ${addedNames.join(', ')}`,
        senderId: 'system',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        read: false,
        isSystem: true
      });
    const updatedChatDoc = await db.collection('chats').doc(selectedChat.id).get();
    const updatedChat = updatedChatDoc.data();
    selectedChat = { ...selectedChat, participants: updatedChat.participants };
    await openChatInfo(selectedChat.id);
    updateChatHeaderParticipantCount();
    if (unsubscribeChats) { unsubscribeChats(); }
    listenForChats();
  } catch (error) {
    console.error('Ошибка добавления участников:', error);
    alert('Ошибка при добавлении участников');
  }
}

async function leaveCurrentGroup() {
  if (!selectedChat || !selectedChat.isGroup) return;
  if (!confirm('Вы уверены, что хотите покинуть беседу?')) return;
  try {
    await db.collection('chats').doc(selectedChat.id)
      .collection('messages')
      .add({
        text: `👋 ${currentUserData.nickname} ${currentUserData.tag} покинул беседу`,
        senderId: 'system',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        read: false,
        isSystem: true
      });
    await db.collection('chats').doc(selectedChat.id).update({
      participants: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
    });
    hideGroupInfoModal();
    exitChatMode();
  } catch (error) {
    console.error('Ошибка при выходе из беседы:', error);
    alert('Ошибка при выходе из беседы');
  }
}

async function deleteCurrentGroup() {
  if (!selectedChat || !selectedChat.isGroup) return;
  if (!confirm('Вы уверены, что хотите удалить эту беседу? Это действие нельзя отменить.')) return;
  try {
    const messagesSnapshot = await db.collection('chats').doc(selectedChat.id)
      .collection('messages')
      .get();
    const batch = db.batch();
    messagesSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(db.collection('chats').doc(selectedChat.id));
    await batch.commit();
    hideGroupInfoModal();
    exitChatMode();
  } catch (error) {
    console.error('Ошибка удаления беседы:', error);
    alert('Ошибка при удалении беседы');
  }
}

function updateChatHeaderParticipantCount() {
  if (selectedChat && selectedChat.isGroup) {
    const participantCount = selectedChat.participants ? selectedChat.participants.length : 2;
    const participantElement = document.querySelector('.selected-chat p');
    if (participantElement) {
      participantElement.textContent = `${participantCount} участников`;
    }
  }
}

// ========== УДАЛЕНИЕ СООБЩЕНИЙ ==========
function showMessageOptions(messageId, event) {
  if (event) event.stopPropagation();
  selectedMessageId = messageId;
  const msgElement = document.getElementById(`msg-${messageId}`);
  if (!msgElement) return;
  const isMyMessage = msgElement.classList.contains('my-message');
  const deleteForEveryoneBtn = document.getElementById('deleteForEveryoneBtn');
  deleteForEveryoneBtn.style.display = isMyMessage ? 'block' : 'none';
  document.getElementById('messageOptionsModal').style.display = 'flex';
}
function hideMessageOptions() {
  document.getElementById('messageOptionsModal').style.display = 'none';
  selectedMessageId = null;
}

// ========== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ОБНОВЛЕНИЯ ПРЕВЬЮ ЧАТА ==========
async function updateChatPreviewAfterDelete(chatId, isForEveryone = false) {
  const snapshot = await db.collection('chats').doc(chatId)
    .collection('messages')
    .orderBy('timestamp', 'desc')
    .limit(20)
    .get();

  let newLastMessage = null;
  let newLastMessageTime = null;

  for (const doc of snapshot.docs) {
    const msg = doc.data();
    if (!msg.deletedFor || (!msg.deletedFor.includes('everyone') && !msg.deletedFor.includes(currentUser.uid))) {
      newLastMessage = msg.text;
      newLastMessageTime = msg.timestamp ? msg.timestamp.toDate() : null;
      break;
    }
  }

  if (isForEveryone) {
    await db.collection('chats').doc(chatId).update({
      lastMessage: newLastMessage,
      lastMessageTime: newLastMessageTime ? firebase.firestore.Timestamp.fromDate(newLastMessageTime) : null
    });
  } else {
    const chatIndex = allChats.findIndex(c => c.id === chatId);
    if (chatIndex !== -1) {
      allChats[chatIndex].lastMessage = newLastMessage;
      allChats[chatIndex].lastMessageTime = newLastMessageTime;
    }
    if (selectedChat && selectedChat.id === chatId) {
      selectedChat.lastMessage = newLastMessage;
      selectedChat.lastMessageTime = newLastMessageTime;
    }
    displayChats(allChats);
  }
}

// ========== ОБНОВЛЁННЫЕ ФУНКЦИИ УДАЛЕНИЯ ==========
async function deleteMessageForMe() {
  if (!selectedMessageId || !currentChatId) return;
  try {
    await db.collection('chats').doc(currentChatId)
      .collection('messages')
      .doc(selectedMessageId)
      .update({
        deletedFor: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
      });
    await loadMessages(false);
    await updateChatPreviewAfterDelete(currentChatId, false);
    saveCache();
    hideMessageOptions();
  } catch (error) {
    console.error('Ошибка удаления сообщения:', error);
    alert('Ошибка при удалении сообщения');
  }
}

async function deleteMessageForEveryone() {
  if (!selectedMessageId || !currentChatId) return;
  if (!confirm('Удалить это сообщение у всех участников?')) return;
  try {
    await db.collection('chats').doc(currentChatId)
      .collection('messages')
      .doc(selectedMessageId)
      .update({
        deletedFor: ['everyone']
      });
    await loadMessages(false);
    await updateChatPreviewAfterDelete(currentChatId, true);
    saveCache();
    hideMessageOptions();
  } catch (error) {
    console.error('Ошибка удаления сообщения:', error);
    alert('Ошибка при удалении сообщения');
  }
}

// ========== ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ (МОБИЛЬНЫЕ) ==========
function enterChatMode() {
  isChatMode = true;
  document.body.classList.add('chat-mode');
  document.getElementById('mobileMenuBtn').style.display = 'none';
  const chatsSidebar = document.getElementById('chatsSidebar');
  if (chatsSidebar) chatsSidebar.style.display = 'none';
  history.pushState({ chatMode: true }, '', window.location.href);
}
function exitChatMode() {
  isChatMode = false;
  document.body.classList.remove('chat-mode');
  document.getElementById('mobileMenuBtn').style.display = 'flex';
  const chatsSidebar = document.getElementById('chatsSidebar');
  if (chatsSidebar) chatsSidebar.style.display = 'flex';
  if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
  selectedChat = null;
  currentChatId = null;
  document.getElementById('chatHeader').innerHTML = '<div class="no-chat-selected">Выберите чат для начала общения</div>';
  document.getElementById('messagesContainer').innerHTML = '';
  document.getElementById('messageInputArea').style.display = 'none';
  isNewChatPending = false;
}

window.addEventListener('popstate', function(event) {
  if (isChatMode) exitChatMode();
});

function openUserProfile(userId) {
  window.location.href = `user.html?id=${userId}`;
}

function toggleMobileMenu() {
  const menu = document.getElementById('mobilePopupMenu');
  const overlay = document.getElementById('mobileMenuOverlay');
  menu.classList.toggle('active');
  overlay.classList.toggle('active');
}

// ========== ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ ==========
window.addEventListener('load', function() {
  if (window.innerWidth <= 768) {
    document.body.classList.remove('chat-mode');
    document.getElementById('mobileMenuBtn').style.display = 'flex';
    document.getElementById('messageInputArea').style.display = 'none';
    const chatsSidebar = document.getElementById('chatsSidebar');
    if (chatsSidebar) chatsSidebar.style.display = 'flex';
  }
});
window.addEventListener('resize', function() {
  if (window.innerWidth > 768) {
    document.body.classList.remove('chat-mode');
    document.getElementById('mobileMenuBtn').style.display = 'none';
    const chatsSidebar = document.getElementById('chatsSidebar');
    if (chatsSidebar) chatsSidebar.style.display = 'flex';
  } else {
    document.getElementById('mobileMenuBtn').style.display = isChatMode ? 'none' : 'flex';
    const chatsSidebar = document.getElementById('chatsSidebar');
    if (chatsSidebar) chatsSidebar.style.display = isChatMode ? 'none' : 'flex';
  }
});

// Запускаем прослушивание чатов после загрузки данных
onAuthStateChanged(async (user) => {
  if (!user || !user.emailVerified) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;

  // 1. Сразу показываем кэш (синхронно)
  const hasCache = loadCachedChats();

  // 2. Загружаем пользователей (асинхронно)
  await loadAllUsers(false);
  await loadAllUsersForModal();

  // 3. Подписываемся на изменения чатов (если кэша не было, то покажет "нет чатов" или загрузит)
  //    Если кэш уже показан, то слушатель обновит его бесшумно
  listenForChats();

  // Если кэша не было, можно показать индикатор загрузки, но он уже есть в HTML
  // Мы его уберём при первом обновлении
});