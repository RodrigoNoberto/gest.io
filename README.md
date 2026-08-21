# Gext.io

Portal de sistemas de gestão desenvolvido em Django. Reúne ferramentas leves de planejamento e apoio operacional em um único ambiente, com interface própria (sidebar, tema e navegação compartilhados entre os produtos).

## Produtos

| Produto | Rota | Descrição |
|---|---|---|
| **Gram.io** (Cronograma) | `/cronograma/` | Planejamento visual de projetos: etapas, prazos, ocupação da equipe e exportação/importação de cronogramas em JSON. Dados persistidos no `localStorage` do navegador. |
| **Temp.io** (Temporizador) | `/temporizador/` | Temporizador para apresentações, com tempos por slide ou por seção, execução em tela cheia e preferências salvas no `localStorage`. |

Além dos produtos, o portal tem páginas institucionais: **Início** (`/`), **Produtos** (`/produtos/`) e **Sobre** (`/sobre/`).

## Stack

- **Backend:** Django 6.1 (Python), views baseadas em função. Sem banco de dados — `admin`, `auth`, `contenttypes` e `sessions` não são usados e foram removidos de `INSTALLED_APPS`.
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

python manage.py runserver
```

O portal fica disponível em `http://127.0.0.1:8000/`.

## Configuração

`config/settings.py` lê as configurações sensíveis de variáveis de ambiente, com valores padrão seguros para desenvolvimento local:

| Variável | Padrão local | Produção |
|---|---|---|
| `SECRET_KEY` | chave de desenvolvimento embutida | defina uma chave própria e secreta |
| `DEBUG` | `False` | mantenha `False` (ou omita a variável) |
| `ALLOWED_HOSTS` | vazio | hosts separados por vírgula, ex. `meusite.com,www.meusite.com` |

Como `DEBUG=False` por padrão, rodar `runserver` localmente exige `ALLOWED_HOSTS` com pelo menos `localhost,127.0.0.1`:

```bash
# Windows (PowerShell)
$env:ALLOWED_HOSTS = "localhost,127.0.0.1"
python manage.py runserver
```

Antes de servir em produção, rode `python manage.py collectstatic` — os arquivos estáticos são servidos via WhiteNoise (`STATIC_ROOT = staticfiles/`, já no `.gitignore`). O servidor de produção recomendado é o `gunicorn` (`gunicorn config.wsgi:application`), incluído no `requirements.txt`.

## Docker

Há um `.dockerignore` preparado no repositório; o `Dockerfile` ainda não foi adicionado.
