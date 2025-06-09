const optionsBtn      = document.getElementById('optionsBtn');
    const dropdown        = document.getElementById('dropdownContent');
    const navbarContainer = document.getElementById('navbarContainer');
    const otherBtn        = document.getElementById('otherBtn');
    const otherMenu       = document.getElementById('otherMenu');

    optionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('show');
      otherMenu.classList.remove('show');
      optionsBtn.classList.toggle('active');
    });

    otherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect       = otherBtn.getBoundingClientRect();
      const parentRect = navbarContainer.getBoundingClientRect();
      const topOffset  = rect.top - parentRect.top + rect.height / 2;
      const leftOffset = rect.right - parentRect.left;
      otherMenu.style.top  = `${topOffset - 73}px`;
      otherMenu.style.left = `${leftOffset}px`;
      otherMenu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!navbarContainer.contains(e.target)) {
        dropdown.classList.remove('show');
        otherMenu.classList.remove('show');
        optionsBtn.classList.remove('active');
      }
    });