const sidebar = document.getElementById('sidebar');

document.getElementById('toggleBtn').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

document.getElementById('grpProjetos').querySelector('.nav-group-toggle').addEventListener('click', () => {
  if (sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
  }
  document.getElementById('grpProjetos').classList.toggle('open');
});

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
