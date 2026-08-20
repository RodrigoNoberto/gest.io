# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Unreleased]

### Adicionado
- Favicon do portal usando o logotipo (`logotipo.svg`) no `base.html`.
- Logotipo no rodapé, ao lado da assinatura "2026 Rodrigo César".

### Alterado
- Logotipo (`static/img/logotipo.svg`) atualizado.
- Ajustes finos de CSS: transição de `gap` nos itens de navegação da sidebar e remoção de padding específico do topo da sidebar quando colapsada.
- `.gitignore` atualizado.
- Texto de formação acadêmica na página "Sobre" expandido (iniciação científica, intercâmbio e área de pesquisa do mestrado).

## [2026-08-20]

### Adicionado
- Logotipo do Gest.io (`e9c34c4`).
- Apps **Cronograma** (Gram.io) e **Temporizador** (Temp.io), com rotas, templates, CSS e JS próprios (`8ecaa39`).

## [2026-08-08]

### Adicionado
- Cronograma de projetos funcional, com persistência local via `localStorage` (`88e15d1`).
- Commit inicial do portal de sistemas de gestão: estrutura Django, app `core` com páginas Início/Produtos/Sobre (`669076c`).
