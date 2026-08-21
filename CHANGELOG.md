# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Unreleased]

### Adicionado
- **Cronograma — rail de ferramentas:** painel branco de altura cheia à direita da tabela, reunindo criar/editar/excluir, importar/exportar e as preferências de leitura (modo apresentação, tela cheia, larguras de coluna). Recolhido por padrão, deixando só o chevron na lateral; o estado fica no `localStorage`.
- **Cronograma — header da página:** faixa branca no topo com o nome do aplicativo e a navegação (seletor de projeto + troca Gantt/Ocupação). Some inteira em tela cheia, e nesse modo a navegação migra para o rail, no grupo "Navegação".
- Ícone `folder` no mapa de fallback do Material Symbols (`material-symbols-fallback.js`), usado pelo menu "Dados" do rail.
- Favicon do portal usando o logotipo (`logotipo.svg`) no `base.html`.
- Logotipo no rodapé, ao lado da assinatura "2026 Rodrigo César".
- WhiteNoise e Gunicorn no `requirements.txt` para servir estáticos e rodar o app em produção.

### Alterado
- **Cronograma — ações reunidas num lugar só:** criar, editar, excluir, importar/exportar e preferências de leitura viviam espalhadas por três lugares (toolbar do topo, barra acima da tabela e header do projeto). Passaram todas para o rail; o topo ficou só com navegação.
- **Cronograma — troca de visão é estado explícito:** o botão que alternava Gantt/Ocupação virou um controle segmentado onde cada botão representa uma visão (`crSetViewMode`). Com alternância, clicar no botão da visão já ativa levava para a outra — o oposto do que um segmentado promete.
- **Cronograma — hierarquia de títulos:** o nome do aplicativo caiu de 28px para 17px e virou chrome; o nome do projeto (19px) passou a ser o maior título da página. O estado anterior destacava o aplicativo, não o assunto da tela.
- **Cronograma — Data de Revisão é sempre hoje:** carimbada em `normalizeProjeto`, que é o ponto único de entrada de dados (localStorage, import e export). Uma data fixa digitada à mão envelhecia junto com o arquivo e o cronograma passava a mentir sobre o próprio atraso.
- **Cronograma — tela vazia com duas saídas:** "Novo projeto" e "Carregar demo". "Importar JSON" e "Baixar JSON demo" saíram de lá e seguem no menu "Dados" do rail: quem chega numa tela vazia ainda não tem arquivo nenhum, e a primeira decisão é começar do zero ou olhar um exemplo pronto.
- Logotipo (`static/img/logotipo.svg`) atualizado.
- Ajustes finos de CSS: transição de `gap` nos itens de navegação da sidebar e remoção de padding específico do topo da sidebar quando colapsada.
- `.gitignore` atualizado.
- Texto de formação acadêmica na página "Sobre" expandido (iniciação científica, intercâmbio e área de pesquisa do mestrado).
- **Preparação para produção:** `SECRET_KEY`, `DEBUG` e `ALLOWED_HOSTS` agora lidos de variáveis de ambiente em `config/settings.py`.
- `requirements.txt` recodificado para UTF-8 (estava em UTF-16, o que quebraria `pip install` em várias plataformas de deploy).

### Removido
- **Cronograma:** linha de apoio do título ("Planeje etapas e tarefas…") e eyebrow "Projetos" — dentro de uma faixa de chrome, ambos repetiam o que a navegação lateral já diz.
- **Cronograma:** botão "Salvar local" do topo, que chamava uma função inexistente (`crSalvarAgora`) — a gravação no `localStorage` já é automática — e a linha de dica que o acompanhava.
- **Cronograma:** campo "Data de revisão" do formulário de projeto e o aviso "defina a Data de Revisão" nos KPIs (ver acima).
- `{% block page_title %}` do template do cronograma: o header da própria página passou a ser o único título.
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
