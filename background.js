const CONFIG = {
  // Customize these patterns for your mail subject format.
  nameRegex: /(?:姓名|name)[:：\s-]*([^,，;；\s]+)/i,
  studentIdRegex: /(?:学号|student\s*id)[:：\s-]*([A-Za-z0-9_-]+)/i,
  courseRegex: /(?:课程|course)[:：\s-]*([^,，;；]+)/i,
  subjectFallbackRegex: /^作业[:：\s-]*([^\s-]+)[\s-]+([A-Za-z0-9_-]+)[\s-]+(.+)$/i,
  plusDelimitedRegex: /^([A-Za-z0-9_-]+)\s*[+＋]\s*([^+＋]+)\s*[+＋]\s*([^+＋]+)\s*[+＋]\s*(.+)$/,
  menuId: "collect-homework-contacts",
};

let pendingMessages = [];

async function ensureAddressBook(name) {
  const books = await browser.addressBooks.list(true);
  const existing = books.find((book) => book.name === name);
  if (existing) {
    return existing.id;
  }

  const created = await browser.addressBooks.create({ name });
  return created.id;
}

function parseSubject(subject) {
  const result = {
    name: "",
    studentId: "",
    course: "",
    assignment: "",
  };

  if (!subject) {
    return result;
  }

  const nameMatch = subject.match(CONFIG.nameRegex);
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  }

  const studentIdMatch = subject.match(CONFIG.studentIdRegex);
  if (studentIdMatch) {
    result.studentId = studentIdMatch[1].trim();
  }

  const courseMatch = subject.match(CONFIG.courseRegex);
  if (courseMatch) {
    result.course = courseMatch[1].trim();
  }

  if (!result.name || !result.studentId || !result.course) {
    const fallback = subject.match(CONFIG.subjectFallbackRegex);
    if (fallback) {
      result.name = result.name || fallback[1].trim();
      result.studentId = result.studentId || fallback[2].trim();
      result.course = result.course || fallback[3].trim();
    }
  }

  if (!result.name || !result.studentId || !result.course || !result.assignment) {
    const plusDelimited = subject.match(CONFIG.plusDelimitedRegex);
    if (plusDelimited) {
      result.studentId = result.studentId || plusDelimited[1].trim();
      result.name = result.name || plusDelimited[2].trim();
      result.course = result.course || plusDelimited[3].trim();
      result.assignment = result.assignment || plusDelimited[4].trim();
    }
  }

  return result;
}

function formatNotes(assignment, originalSubject) {
  const lines = [];
  if (assignment) {
    lines.push(`作业名: ${assignment}`);
  }
  lines.push(`来源主题: ${originalSubject || "(空主题)"}`);
  return lines.join("\n");
}

async function findContactByEmail(addressBookId, email) {
  if (!email) {
    return null;
  }

  const contacts = await browser.contacts.list(addressBookId);
  return contacts.find((contact) => {
    const primary = (contact.properties?.PrimaryEmail || "").toLowerCase();
    return primary === email.toLowerCase();
  }) || null;
}

function parseFromHeader(raw) {
  if (!raw) {
    return { name: "", email: "" };
  }
  // "Display Name" <addr@example.com>  or  Display Name <addr>  or  addr@example.com
  const angleMatch = raw.match(/^(.*?)<([^>]+)>\s*$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].replace(/^["'\s]+|["'\s]+$/g, ""),
      email: angleMatch[2].trim(),
    };
  }
  return { name: "", email: raw.trim() };
}

async function upsertContactFromMessage(addressBookId, message) {
  const full = await browser.messages.getFull(message.id);
  const headers = full.headers || {};
  const fromHeader = headers.from?.[0] || message.author || "";
  const sender = parseFromHeader(fromHeader);

  if (!sender.email) {
    return;
  }

  const email = sender.email.trim();
  const subject = message.subject || "";
  const subjectData = parseSubject(subject);
  const displayName = subjectData.name || sender.name || email;

  const existing = await findContactByEmail(addressBookId, email);
  const props = {
    DisplayName: displayName,
    PrimaryEmail: email,
    JobTitle: subjectData.studentId, // 兼容 CardDAV (TITLE)
    // Organization: subjectData.course, // 兼容 CardDAV (ORG)
    Notes: formatNotes(subjectData.assignment, subject),
  };

  if (existing) {
    await browser.contacts.update(existing.id, props);
  } else {
    await browser.contacts.create(addressBookId, null, props);
  }
}

async function processMessages(messages, addressBookName) {
  if (!messages || messages.length === 0) {
    return;
  }
  const addressBookId = await ensureAddressBook(addressBookName);
  
  const processedEmails = new Set();
  
  for (const message of messages) {
    const rawAuthor = message.author || "";
    const senderInfo = parseFromHeader(rawAuthor);
    const email = senderInfo.email ? senderInfo.email.toLowerCase() : null;

    if (email) {
      if (processedEmails.has(email)) {
        continue;
      }
      processedEmails.add(email);
    }

    await upsertContactFromMessage(addressBookId, message);
  }
}

async function getAllSelectedMessages(tab) {
  if (!tab || typeof tab.id !== "number") {
    return [];
  }

  const selected = await browser.mailTabs.getSelectedMessages(tab.id);
  const allMessages = [...(selected.messages || [])];
  let listId = selected.id;

  while (listId) {
    const next = await browser.messages.continueList(listId);
    allMessages.push(...(next.messages || []));
    listId = next.id;
  }

  return allMessages;
}

async function onMenuClicked(info, tab) {
  if (info.menuItemId !== CONFIG.menuId) {
    return;
  }
  pendingMessages = await getAllSelectedMessages(tab);
  if (pendingMessages.length === 0) {
    return;
  }
  const url = browser.runtime.getURL("picker.html");
  await browser.windows.create({ url, type: "popup", width: 420, height: 250 });
}

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === "get-address-books") {
    const books = await browser.addressBooks.list(false);
    return books.map((b) => ({ id: b.id, name: b.name }));
  }
  if (msg.action === "confirm-save") {
    const msgs = pendingMessages;
    pendingMessages = [];
    try {
      await processMessages(msgs, msg.bookName);
      return { ok: true, count: msgs.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
});

browser.menus.create({
  id: CONFIG.menuId,
  title: "保存选中邮件到课程联系人",
  contexts: ["message_list"],
});

browser.menus.onClicked.addListener(onMenuClicked);

console.log("Homework Contact Collector loaded (manual mode).");
