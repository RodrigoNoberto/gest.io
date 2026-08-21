# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Unreleased]

### Adicionado
- Favicon do portal usando o logotipo (`logotipo.svg`) no `base.html`.
- Logotipo no rodapé, ao lado da assinatura "2026 Rodrigo César".
- WhiteNoise e Gunicorn no `requirements.txt` para servir estáticos e rodar o app em produção.

### Alterado
- Logotipo (`static/img/logotipo.svg`) atualizado.
- Ajustes finos de CSS: transição de `gap` nos itens de navegação da sidebar e remoção de padding específico do topo da sidebar quando colapsada.
- `.gitignore` atualizado.
- Texto de formação acadêmica na página "Sobre" expandido (iniciação científica, intercâmbio e área de pesquisa do mestrado).
- **Preparação para produção:** `SECRET_KEY`, `DEBUG` e `ALLOWED_HOSTS` agora lidos de variáveis de ambiente em `config/settings.py`.
- `requirements.txt` recodificado para UTF-8 (estava em UTF-16, o que quebraria `pip install` em várias plataformas de deploy).

### Removido
- `django.contrib.admin`, `auth`, `contenttypes` e `sessions` de `INSTALLED_APPS`/`MIDDLEWARE` — nenhum produto usa login, admin ou grava dados no banco (persistência é via `localStorage`).
- `DATABASES` (SQLite) e `db.sqlite3`: sem apps com models, o banco não tinha função.

## [2026-08-20]

### Adicionado
- Logotipo do Gext.io (`e9c34c4`).
- Apps **Cronograma** (Gram.io) e **Temporizador** (Temp.io), com rotas, templates, CSS e JS próprios (`8ecaa39`).

## [2026-08-08]

### Adicionado
- Cronograma de projetos funcional, com persistência local via `localStorage` (`88e15d1`).
- Commit inicial do portal de sistemas de gestão: estrutura Django, app `core` com páginas Início/Produtos/Sobre (`669076c`).
