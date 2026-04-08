(async () => {
  const select = document.getElementById("bookSelect");
  const newBookArea = document.getElementById("newBookArea");
  const newBookInput = document.getElementById("newBookName");
  const statusEl = document.getElementById("status");
  const confirmBtn = document.getElementById("confirmBtn");

  let books = [];

  try {
    books = await browser.runtime.sendMessage({ action: "get-address-books" });
  } catch (e) {
    statusEl.textContent = "无法读取通讯录列表：" + e.message;
  }

  for (const book of books) {
    const opt = document.createElement("option");
    opt.value = book.id;
    opt.textContent = book.name;
    select.appendChild(opt);
  }

  const newOpt = document.createElement("option");
  newOpt.value = "__new__";
  newOpt.textContent = "＋ 新建通讯录…";
  select.appendChild(newOpt);

  select.addEventListener("change", () => {
    newBookArea.style.display = select.value === "__new__" ? "block" : "none";
  });

  document.getElementById("cancelBtn").addEventListener("click", () => {
    window.close();
  });

  confirmBtn.addEventListener("click", async () => {
    statusEl.textContent = "";

    let bookName;
    if (select.value === "__new__") {
      bookName = newBookInput.value.trim();
      if (!bookName) {
        statusEl.textContent = "请输入通讯录名称。";
        return;
      }
    } else {
      const found = books.find((b) => b.id === select.value);
      if (!found) {
        statusEl.textContent = "请选择一个通讯录。";
        return;
      }
      bookName = found.name;
    }

    confirmBtn.disabled = true;
    const result = await browser.runtime.sendMessage({ action: "confirm-save", bookName });
    if (result && result.ok) {
      window.close();
    } else {
      statusEl.textContent = "保存失败：" + (result?.error || "未知错误");
      confirmBtn.disabled = false;
    }
  });
})();
