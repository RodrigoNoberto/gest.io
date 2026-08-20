const sidebar = document.getElementById('sidebar');
const toggleBtn = document.getElementById('toggleBtn');

if (sidebar && toggleBtn) {
  const updateSidebarToggleLabel = () => {
    const isCollapsed = sidebar.classList.contains('collapsed');
    toggleBtn.setAttribute('aria-label', isCollapsed ? 'Expandir menu' : 'Recolher menu');
    toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
  };

  updateSidebarToggleLabel();

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    updateSidebarToggleLabel();
  });
}

const grpProjetos = document.getElementById('grpProjetos');
const grpProjetosToggle = grpProjetos?.querySelector('.nav-group-toggle');

if (sidebar && grpProjetos && grpProjetosToggle) {
  grpProjetosToggle.addEventListener('click', () => {
    if (sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      toggleBtn.setAttribute('aria-label', 'Recolher menu');
      toggleBtn.setAttribute('aria-expanded', 'true');
    }
    grpProjetos.classList.toggle('open');
  });
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
}));

document.querySelectorAll('.seg-toggle button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.seg-toggle button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));

const avatarBtn = document.getElementById('avatarBtn');
const userDropdown = document.getElementById('userDropdown');

if (avatarBtn && userDropdown) {
  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = userDropdown.classList.toggle('open');
    avatarBtn.setAttribute('aria-expanded', isOpen);
  });

  document.addEventListener('click', (e) => {
    if (!avatarBtn.contains(e.target) && !userDropdown.contains(e.target)) {
      userDropdown.classList.remove('open');
      avatarBtn.setAttribute('aria-expanded', 'false');
    }
  });
}
