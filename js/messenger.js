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
let loadingTimer = null;
let messageListenerInitialized = false; // флаг, чтобы не создавать дублирующие слушатели

// Ключи для localStorage
const CACHE_CHATS_KEY = 'messenger_chats_cache';
const CACHE_USERS_KEY = 'messenger_users_cache';
const CACHE_UNREAD_KEY = 'messenger_unread_cache';

// ========== УПРАВЛЕНИЕ ИНДИКАТОРОМ ЗАГРУЗКИ ==========
function showLoadingIndicator(show) {
  const chatsList = document.getElementById('chatsList');
  if (!chatsList) return;
  if (show) {
    if (!chatsList.querySelector('.loading')) {
      chatsList.innerHTML = '<div class="loading">Загрузка чатов...</div>';
    }
  } else {
    const loadingEl = chatsList.querySelector('.loading');
    if (loadingEl) loadingEl.remove();
  }
}

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

// ========== ПРОСЛУШИВАНИЕ ЧАТОВ ==========
function listenForChats() {
  if (!currentUser) return;
  if (unsubscribeChats) unsubscribeChats();

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
        if (loadingTimer) {
          clearTimeout(loadingTimer);
          loadingTimer = null;
        }
        showLoadingIndicator(false);
      }
    } catch (e) { /* игнорируем */ }
  }

  unsubscribeChats = db.collection('chats')
    .where('participants', 'array-contains', currentUser.uid)
    .onSnapshot(snapshot => {
      const chatsList = document.getElementById('chatsList');
      if (!chatsList) return;

      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
      showLoadingIndicator(false);

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
            // Подписываемся на сообщения нового чата (если ещё не подписаны)
            if (currentChatId) {
              subscribeToMessages(currentChatId);
            }
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
  // Отписываемся от старого слушателя сообщений, если он был
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

  // Подписываемся на сообщения этого чата (вместо однократной загрузки)
  subscribeToMessages(chat.id);

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
    saveCache();
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

// ========== НОВАЯ ФУНКЦИЯ: ПОДПИСКА НА СООБЩЕНИЯ (реальный времени) ==========
function subscribeToMessages(chatId) {
  // Отписываемся от предыдущего слушателя
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }

  const messagesRef = db.collection('chats').doc(chatId)
    .collection('messages')
    .orderBy('timestamp', 'asc');

  unsubscribeMessages = messagesRef.onSnapshot(async (snapshot) => {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    // Собираем все сообщения, не удалённые для текущего пользователя
    const visibleMessages = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // Проверяем, не удалено ли сообщение для текущего пользователя
      if (data.deletedFor && 
          (data.deletedFor.includes('everyone') || data.deletedFor.includes(currentUser.uid))) {
        return; // пропускаем
      }
      visibleMessages.push({ id: doc.id, ...data });
    });

    // Если сообщений нет – показываем заглушку
    if (visibleMessages.length === 0) {
      container.innerHTML = '<div class="no-messages">Нет сообщений. Напишите что-нибудь!</div>';
      return;
    }

    // Рендерим сообщения
    renderMessages(visibleMessages, container);

    // Отмечаем прочитанные (если нужно)
    await markReadMessages(visibleMessages);

    // Прокручиваем вниз, если пользователь не поднялся вверх
    const isScrolledToBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    if (isScrolledToBottom) {
      container.scrollTop = container.scrollHeight;
    }

  }, (error) => {
    console.error('Ошибка слушателя сообщений:', error);
  });
}

// ========== НОВАЯ ФУНКЦИЯ: РЕНДЕРИНГ СООБЩЕНИЙ ==========
function renderMessages(messages, container) {
  // Кэш для отправителей (чтобы не грузить каждого заново)
  const senderCache = {};

  // Сначала соберём всех отправителей (для групповых чатов)
  if (selectedChat && selectedChat.isGroup) {
    const senderIds = new Set();
    messages.forEach(msg => {
      if (!msg.isSystem && msg.senderId !== currentUser.uid) {
        senderIds.add(msg.senderId);
      }
    });
    // Загружаем их асинхронно (можно сделать через Promise.all)
    // Но для простоты будем загружать по мере необходимости, используя глобальный кэш
    // В этой функции мы не можем использовать await, поэтому будем использовать синхронный кэш
    // Вместо этого мы можем вызвать асинхронную загрузку отдельно и потом перерисовать,
    // но для упрощения используем уже загруженных пользователей из allUsers или userCache.
    // Если пользователя нет в кэше, покажем "?"
  }

  let html = '';
  let lastDate = '';

  const nonSystemMessages = messages.filter(msg => !msg.isSystem);
  if (nonSystemMessages.length === 0) {
    // Только системные сообщения
    messages.forEach(msg => {
      if (msg.isSystem) {
        html += `<div class="message system"><div class="message-content">${msg.text}</div></div>`;
      }
    });
  } else {
    messages.forEach(msg => {
      const isMyMessage = msg.senderId === currentUser.uid;
      let time = '';
      let messageDate = '';
      if (msg.timestamp) {
        const date = msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
        time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageDate = date.toLocaleDateString();
      }

      // Разделитель дат
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
        // Получаем отправителя из глобального кэша
        const sender = allUsers.find(u => u.id === msg.senderId) || userCache.get(msg.senderId);
        if (sender) {
          senderInfo = `<div class="message-sender">${sender.nickname || '?'} ${sender.tag || ''}</div>`;
        } else {
          // Если нет в кэше, загружаем асинхронно (но это может вызвать задержку)
          // Для простоты оставим пустым, или можно инициировать загрузку отдельно
          // В данном случае мы можем показать "?"
          senderInfo = `<div class="message-sender">?</div>`;
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

  container.innerHTML = html;
}

// ========== НОВАЯ ФУНКЦИЯ: ОТМЕТКА ПРОЧИТАННЫХ В РЕЖИМЕ РЕАЛЬНОГО ВРЕМЕНИ ==========
async function markReadMessages(messages) {
  if (!currentChatId) return;
  if (selectedChat.isGroup) {
    // Для групповых: отмечаем readBy для каждого сообщения, где мы ещё не читали
    const batch = db.batch();
    let hasChanges = false;
    messages.forEach(msg => {
      if (msg.senderId !== currentUser.uid && !msg.isSystem) {
        if (!msg.readBy || !msg.readBy.includes(currentUser.uid)) {
          const ref = db.collection('chats').doc(currentChatId).collection('messages').doc(msg.id);
          batch.update(ref, { readBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid) });
          hasChanges = true;
        }
      }
    });
    if (hasChanges) {
      await batch.commit();
      // Обновляем счётчик непрочитанных (если он был)
      if (unreadCounts[currentChatId] && unreadCounts[currentChatId] > 0) {
        unreadCounts[currentChatId] = 0;
        saveCache();
        // Обновляем отображение в списке чатов
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
    }
  } else {
    // Личный чат: отмечаем read = true
    const batch = db.batch();
    let hasChanges = false;
    messages.forEach(msg => {
      if (msg.receiverId === currentUser.uid && !msg.read) {
        const ref = db.collection('chats').doc(currentChatId).collection('messages').doc(msg.id);
        batch.update(ref, { read: true });
        hasChanges = true;
      }
    });
    if (hasChanges) {
      await batch.commit();
      if (unreadCounts[currentChatId] && unreadCounts[currentChatId] > 0) {
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
    }
  }
}

// ========== ОБНОВЛЕНИЕ ПРЕВЬЮ ПОСЛЕ УДАЛЕНИЯ ==========
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
    saveCache();
    displayChats(allChats);
  }
}

// ========== ОТПРАВКА СООБЩЕНИЯ (без перезагрузки, т.к. слушатель обновит) ==========
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

      // Подписываемся на сообщения нового чата
      subscribeToMessages(chatId);
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

    // Не вызываем loadMessages, слушатель сам обновит

  } catch (error) {
    console.error('Ошибка отправки:', error);
    alert('Ошибка при отправке сообщения');
    input.value = text;
  }
}

// ========== УДАЛЕНИЕ СООБЩЕНИЙ (без перезагрузки, слушатель обновит) ==========
async function deleteMessageForMe() {
  if (!selectedMessageId || !currentChatId) return;
  try {
    await db.collection('chats').doc(currentChatId)
      .collection('messages')
      .doc(selectedMessageId)
      .update({
        deletedFor: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
      });
    // Слушатель сам обновит сообщения, не нужно вызывать loadMessages
    // Обновляем превью чата (список чатов)
    await updateChatPreviewAfterDelete(currentChatId, false);
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
    // Слушатель сам обновит
    await updateChatPreviewAfterDelete(currentChatId, true);
    hideMessageOptions();
  } catch (error) {
    console.error('Ошибка удаления сообщения:', error);
    alert('Ошибка при удалении сообщения');
  }
}

// ========== ОСТАЛЬНЫЕ ФУНКЦИИ (ГРУППЫ, МОДАЛКИ, МОБИЛЬНОЕ МЕНЮ) ==========
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
  // Отписываемся от слушателя сообщений
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }
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

// ========== ИНИЦИАЛИЗАЦИЯ ==========
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

// Запуск после авторизации
onAuthStateChanged(async (user) => {
  if (!user || !user.emailVerified) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;

  const hasCache = loadCachedChats();

  if (!hasCache) {
    loadingTimer = setTimeout(() => {
      showLoadingIndicator(true);
    }, 300);
  }

  await loadAllUsers(false);
  await loadAllUsersForModal();

  listenForChats();
});