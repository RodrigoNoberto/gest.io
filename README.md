# Gest.io

Portal de sistemas de gestão desenvolvido em Django. Reúne ferramentas leves de planejamento e apoio operacional em um único ambiente, com interface própria (sidebar, tema e navegação compartilhados entre os produtos).

## Produtos

| Produto | Rota | Descrição |
|---|---|---|
| **Gram.io** (Cronograma) | `/cronograma/` | Planejamento visual de projetos: etapas, prazos, ocupação da equipe e exportação/importação de cronogramas em JSON. Dados persistidos no `localStorage` do navegador. |
| **Temp.io** (Temporizador) | `/temporizador/` | Temporizador para apresentações, com tempos por slide ou por seção, execução em tela cheia e preferências salvas no `localStorage`. |

Além dos produtos, o portal tem páginas institucionais: **Início** (`/`), **Produtos** (`/produtos/`) e **Sobre** (`/sobre/`).

## Stack

- **Backend:** Django 6.1 (Python), views baseadas em função, sem uso de banco de dados além do SQLite padrão (os apps ainda não possuem models).
- **Frontend:** HTML/CSS/JS "vanilla", sem framework de build — templates Django + arquivos estáticos servidos via `django.contrib.staticfiles`.
- **Persistência dos produtos:** `localStorage` no navegador (Cronograma e Temporizador não gravam dados no servidor).

## Estrutura do projeto

```
config/            # settings, urls, wsgi/asgi
apps/
  core/             # páginas institucionais (home, produtos, sobre)
  cronograma/        # produto Gram.io
  temporizador/      # produto Temp.io
static/
  css/, js/, img/, data/
manage.py
requirements.txt
```

## Como rodar localmente

Pré-requisitos: Python 3.13+.

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt

python manage.py migrate
python manage.py runserver
```

O portal fica disponível em `http://127.0.0.1:8000/`.

## Configuração

O projeto usa configurações padrão de desenvolvimento em `config/settings.py` (`DEBUG=True`, SQLite local). Há um arquivo `.env` reservado para variáveis de ambiente (ignorado pelo Git), mas nenhuma variável é lida dele atualmente.

> Antes de qualquer deploy em produção, revise `SECRET_KEY`, `DEBUG` e `ALLOWED_HOSTS` em `config/settings.py` — os valores atuais são apenas para desenvolvimento local.

## Docker

Há um `.dockerignore` preparado no repositório; o `Dockerfile` ainda não foi adicionado.
