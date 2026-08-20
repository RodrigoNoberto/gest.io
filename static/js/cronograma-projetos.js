/* Cronograma de projetos: importa, edita, salva no localStorage e exporta JSON. */
(function () {
  'use strict';

  /* ---------- CONFIG / PERSISTÊNCIA LOCAL ---------- */
  var PAGE_SLUG = location.pathname.replace(/\/$/, '').split('/').pop().replace(/\.html?$/i, '') || 'cronograma-projetos';
  var STORAGE_KEY = 'cr:' + PAGE_SLUG + ':data';
  var DEMO_URL = '/static/data/cronograma-exemplo.json';

  var DATA = null;               // {version, projetos:[...]}
  var CUR_PROJ_ID = null;
  var PRESENT_MODE = false;      // modo apresentação: esconde ações de edição
  var PRESENT_KEY = 'cr:' + PAGE_SLUG + ':present';
  var COLLAPSED = {};            // etapaId -> bool (true = oculta tarefas)

  /* ---- visão de Ocupação da equipe (preferências de tela, não de dados) ----
     Nada daqui entra no JSON do cronograma: são escolhas de leitura de
     cada um, então vivem só no localStorage. */
  var VIEW_MODE = 'gantt';       // gantt|ocupacao
  var VIEW_KEY = 'cr:' + PAGE_SLUG + ':view';
  var ALOC_UNIDADE = 'semanas';  // granularidade da grade de ocupação
  var ALOC_UNIDADE_KEY = 'cr:' + PAGE_SLUG + ':alocunidade';
  var ALOC_EXCL = {};            // projetoId -> true = fora da conta de carga
  var ALOC_EXCL_KEY = 'cr:' + PAGE_SLUG + ':alocexcl';
  var ALOC_HIDE_DONE = false;
  var ALOC_HIDE_DONE_KEY = 'cr:' + PAGE_SLUG + ':alochidedone';
  var ALOC_COLLAPSED = {};       // pessoaKey -> true = esconde as sub-linhas de projeto
  var ALOC_COLLAPSED_KEY = 'cr:' + PAGE_SLUG + ':aloccollapsed';
  var ALOC_DECIDED = {};         // projetoId -> true = usuário já escolheu explicitamente incluir/excluir
  var ALOC_DECIDED_KEY = 'cr:' + PAGE_SLUG + ':alocdecided';
  var ALOC_PICK_OPEN = false;    // <details> do seletor de projetos aberto (não persiste)
  /* Este persiste, diferente do ALOC_PICK_OPEN acima: quem apresenta o
     cronograma quer o painel de FCA aberto toda vez, e a página remonta o HTML a
     cada clique em célula — sem guardar, o painel fecharia sozinho no meio da
     reunião. */
  var FCA_PANEL_OPEN = false;
  var FCA_PANEL_KEY = 'cr:' + PAGE_SLUG + ':fcapanel';

  function lsGetJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); } catch (e) { }
  }

  /* ---------- LARGURA DAS COLUNAS ----------
     Preferência de LEITURA, igual às da visão de Ocupação: vive no
     localStorage de cada um e não entra no JSON do cronograma.
     `periodo` é uma largura só pra TODAS as colunas de período: elas são
     homogêneas (uma semana / um mês cada) e o horizonte muda de tamanho
     conforme as datas das tarefas — largura por índice viraria lixo no
     primeiro replanejamento. */
  var COLW = {};
  var COLW_KEY = 'cr:' + PAGE_SLUG + ':colw';
  var COLW_MAX = 900;
  /* def = largura de partida · min = piso do arraste · grow = teto até onde a
     coluna aceita crescer pra ocupar a sobra do painel (ver applyColLayout) */
  var COL_DEFS = {
    num: { def: 38, min: 26 }, titulo: { def: 260, min: 110, grow: 560 }, resp: { def: 120, min: 60, grow: 150 },
    inicio: { def: 88, min: 56 }, fim: { def: 88, min: 56 }, novoprazo: { def: 96, min: 56 },
    conclusao: { def: 88, min: 56 }, pr: { def: 28, min: 24 }, periodo: { def: 56, min: 26, grow: 110 },
    anome: { def: 260, min: 120, grow: 560 }, apico: { def: 52, min: 40 },
  };
  /* quem recebe a sobra, nesta ordem: primeiro o texto (é ele que fica
     ilegível quando falta espaço), depois a régua de períodos */
  var GROW_ORDER = ['titulo', 'anome', 'resp', 'periodo'];
  var GANTT_LEAD = ['num', 'titulo', 'resp', 'inicio', 'fim', 'novoprazo', 'conclusao', 'pr'];
  var ALOC_LEAD = ['anome', 'apico'];
  /* chaves na ordem das <col> do render atual — o arraste precisa saber qual
     <col> mexer sem depender de qual visão está na tela */
  var LAST_COLKEYS = null;

  function colw(k) {
    var d = COL_DEFS[k];
    if (!d) return 56;
    var v = parseInt(COLW[k], 10);
    // pisa no default se o valor guardado for lixo (localStorage editado à
    // mão, versão antiga da página): coluna de 0 ou de 30.000px trava a tela
    return (v && v >= d.min) ? Math.min(v, COLW_MAX) : d.def;
  }
  /* true = o usuário fixou esta coluna à mão. Repete o teste de sanidade do
     colw() de propósito: valor-lixo no localStorage tem que se comportar
     igual a "sem preferência" nos dois lugares, senão a coluna fica no
     default E fora da esticada. */
  function colwManual(k) {
    var d = COL_DEFS[k];
    if (!d) return false;
    var v = parseInt(COLW[k], 10);
    return !!(v && v >= d.min);
  }
  function colgroupHTML(lead, nPeriodos) {
    var keys = lead.slice();
    for (var i = 0; i < nPeriodos; i++) keys.push('periodo');
    LAST_COLKEYS = keys;
    return '<colgroup>' +
      keys.map(function (k) { return '<col style="width:' + colw(k) + 'px">'; }).join('') +
      '<col class="cr-colspacer"></colgroup>';
  }
  function rszHandle(key) {
    return '<span class="cr-rsz" data-col="' + key + '" title="Arraste para ajustar a largura' +
      (key === 'periodo' ? ' de todos os períodos' : '') + ' · duplo-clique volta ao padrão"></span>';
  }
  /* Aplica as larguras sem re-renderizar: mexe nas <col> e nas variáveis CSS.
     É o que deixa o arraste fluido — um render() por movimento do mouse
     remontaria a tabela inteira a cada pixel. */
  var COLW_EFF = {};
  function applyColLayout() {
    var root = document.getElementById('cr-root');
    if (!root || !LAST_COLKEYS) return;
    var table = document.querySelector('table.cr-gantt');
    var cols = table ? table.querySelectorAll('colgroup col') : [];

    // 1) largura pedida: o que o usuário arrastou, ou o default
    var W = {}, nPer = 0;
    LAST_COLKEYS.forEach(function (k) {
      if (W[k] == null) W[k] = colw(k);
      if (k === 'periodo') nPer++;
    });
    var soma = function () {
      var t = 0;
      LAST_COLKEYS.forEach(function (k) { t += W[k]; });
      return t;
    };

    /* 2) esticada: com table-layout:fixed a soma das larguras é a largura da
       tabela, então em projeto de horizonte curto sobrava um vão à direita.
       A sobra é distribuída pelas colunas de GROW_ORDER, respeitando o teto
       de cada uma. Coluna que o usuário fixou à mão (está em COLW) fica FORA:
       arrastar pra estreita e ver a coluna voltar sozinha seria arraste
       quebrado. */
    var wrap = table ? table.closest('.cr-ganttwrap') : null;
    var folga = (wrap ? wrap.clientWidth : 0) - soma() - 1;
    if (folga > 0) {
      GROW_ORDER.forEach(function (k) {
        var d = COL_DEFS[k];
        if (folga <= 0 || W[k] == null || colwManual(k) || !d || !d.grow) return;
        var n = (k === 'periodo' ? nPer : 1);
        var add = Math.min(Math.floor(folga / n), Math.max(0, d.grow - W[k]));
        if (add <= 0) return;
        W[k] += add;
        folga -= add * n;
      });
      /* sobra teimosa (horizonte de 1-2 períodos, todos os tetos atingidos):
         vai pros períodos sem teto — célula larga incomoda menos que vão */
      if (nPer > 0 && folga > nPer && !colwManual('periodo')) {
        W.periodo = Math.min(COLW_MAX, W.periodo + Math.floor(folga / nPer));
      }
    }
    COLW_EFF = W;

    var total = 0;
    LAST_COLKEYS.forEach(function (k, i) {
      total += W[k];
      if (cols[i]) cols[i].style.width = W[k] + 'px';
    });
    root.style.setProperty('--cr-tw', total + 'px');
    // offsets das colunas fixas: derivados das larguras JÁ esticadas
    var eff = function (k) { return W[k] != null ? W[k] : colw(k); };
    root.style.setProperty('--cr-l-titulo', eff('num') + 'px');
    root.style.setProperty('--cr-l-pr', (eff('num') + eff('titulo')) + 'px');
    root.style.setProperty('--cr-l-apico', eff('anome') + 'px');
  }
  /* Duas passadas de propósito: a primeira pode fazer aparecer (ou sumir) a
     barra de rolagem vertical do painel, e é do clientWidth dele que sai a
     esticada. Sem a segunda, ou sobra um vão de ~15px, ou aparece barra
     horizontal numa tabela que caberia. */
  function relayout() { applyColLayout(); syncTableMaxHeight(); applyColLayout(); }
  var COL_DRAG = null;
  function rszAlvo(ev) {
    var el = ev.target;
    return (el && el.closest) ? el.closest('.cr-rsz') : null;
  }
  document.addEventListener('mousedown', function (ev) {
    var h = rszAlvo(ev); if (!h) return;
    ev.preventDefault(); ev.stopPropagation();
    var k = h.getAttribute('data-col');
    // parte da largura EFETIVA (já esticada), senão o primeiro pixel de
    // arraste faria a coluna pular de volta pra largura de partida
    COL_DRAG = { key: k, x0: ev.clientX, w0: (COLW_EFF[k] != null ? COLW_EFF[k] : colw(k)) };
    document.body.style.userSelect = 'none';   // senão o arraste seleciona o texto da tabela
  });
  document.addEventListener('mousemove', function (ev) {
    if (!COL_DRAG) return;
    var d = COL_DEFS[COL_DRAG.key] || { min: 26 };
    COLW[COL_DRAG.key] = Math.max(d.min, Math.min(COLW_MAX, Math.round(COL_DRAG.w0 + (ev.clientX - COL_DRAG.x0))));
    applyColLayout();
  });
  document.addEventListener('mouseup', function () {
    if (!COL_DRAG) return;
    COL_DRAG = null;
    document.body.style.userSelect = '';
    lsSet(COLW_KEY, COLW);
    relayout();   // título que passou a quebrar em 3 linhas muda a altura das linhas
  });
  document.addEventListener('dblclick', function (ev) {
    var h = rszAlvo(ev); if (!h) return;
    ev.preventDefault();
    delete COLW[h.getAttribute('data-col')];
    lsSet(COLW_KEY, COLW); relayout();
  });
  window.crResetColWidths = function () {
    COLW = {};
    lsSet(COLW_KEY, COLW); relayout();
    toast('Colunas de volta à largura padrão.');
  };

  function isEditable() { return !PRESENT_MODE; }

  /* ---------- HELPERS ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  /* IDs entram em atributos onclick='...' sem passar por esc() (esc() não
     protege contexto de atributo/JS-string). uid() só produz [0-9a-z], mas
     um JSON importado poderia trazer um id malicioso com aspas — normalizeData()
     usa safeId() em todo id vindo de fora pra fechar essa brecha. */
  function safeId(id) { return (typeof id === 'string' && /^[a-z0-9]{4,24}$/.test(id)) ? id : uid(); }
  function toast(msg, err) { var t = document.getElementById('cr-toast'); if (!t) return; t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); setTimeout(function () { t.className = ''; }, 2600); }
  function fmtDateBR(iso) { if (!iso) return '—'; var p = String(iso).split('-'); return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : iso; }
  /* timestamp (ms) → "05/08/2026 às 14:32". Só pro aviso de rascunho pendente:
     é a informação que decide se vale restaurar ("deixei isso agora" × "isso é
     de terça-feira"). */
  function fmtDataHora(ts) {
    var d = new Date(+ts || 0);
    if (!ts || isNaN(d.getTime())) return '';
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear() +
      ' às ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  /* tira acento decompondo em NFD e removendo os diacríticos combinantes.
     Usado por pessoaKey() pra agrupar responsável — sem isso "Élida" e "Elida"
     viram duas pessoas na visão de Ocupação. (normLabel(), mais abaixo, faz o
     mesmo inline pros rótulos de entrada.) */
  var DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');
  function deaccent(s) { return String(s == null ? '' : s).normalize('NFD').replace(DIACRITICOS, ''); }
  function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function todayISO() { return isoOf(new Date()); }

  /* ---------- DATAS (uma única fonte de parsing — evita bug UTC×local) ---------- */
  function parseISO(iso) {
    if (!iso) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    var dt = new Date(y, mo, d);
    return (dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d) ? dt : null;
  }
  function weekStart(d) {
    var dow = (d.getDay() + 6) % 7; // 0 = segunda
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  }
  var EPOCH_MONDAY = new Date(2000, 0, 3); // uma segunda-feira qualquer, serve de referência
  function bucketKey(d, unidade) {
    if (unidade === 'semanas') {
      /* ⚠ O Math.round é load-bearing. EPOCH_MONDAY é 2000-01-03, data que caiu
         DENTRO do horário de verão brasileiro (UTC-2); hoje estamos em UTC-3,
         então a subtração de timestamps absolutos deixa um resíduo de 1h. Sem
         arredondar, `(n semanas + 1h)/1 semana` truncaria pra n-1 em parte dos
         casos. Com Math.round, 1h/168h ≈ 0,006 desaparece. */
      return Math.round((weekStart(d) - EPOCH_MONDAY) / 604800000);
    }
    return d.getFullYear() * 12 + d.getMonth();
  }
  /* Data de início do período (segunda-feira da semana, dia 1º do mês) a partir
     da chave do bucket. FONTE ÚNICA: o rótulo da coluna (bucketLabel) e a chave
     canônica do mapa `realizado` (periodoISO) saem os dois daqui.

     ⚠ Conta em DIAS DE CALENDÁRIO, nunca somando milissegundos a EPOCH_MONDAY.
     Somar 604800000 devolveria, hoje, "segunda-feira menos 1h" — o DOMINGO
     anterior (mesmo resíduo de horário de verão explicado em bucketKey). Isso
     era um bug de verdade, e ficou meses escondido porque um SEGUNDO erro o
     compensava: o bucketLabel somava 5 dias pra achar a sexta, e de domingo +5
     dá sexta. Corrigidos os dois juntos (ago/2026) — de segunda, a sexta é +4.
     Se você mexer num, confira o outro: cada um sozinho desloca todos os
     rótulos semanais em um dia, sem estourar erro nenhum. */
  function bucketStartDate(key, unidade) {
    if (unidade === 'semanas') {
      return new Date(EPOCH_MONDAY.getFullYear(), EPOCH_MONDAY.getMonth(),
        EPOCH_MONDAY.getDate() + key * 7);
    }
    var y = Math.floor(key / 12), m = ((key % 12) + 12) % 12;
    return new Date(y, m, 1);
  }
  var MESES_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function bucketLabel(key, unidade) {
    var start = bucketStartDate(key, unidade);
    if (unidade === 'semanas') {
      // representa a semana pela data da sexta-feira (start é a segunda-feira
      // daquela semana), mesmo que a sexta caia em feriado/não seja dia útil.
      var sex = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 4);
      return String(sex.getDate()).padStart(2, '0') + '/' + String(sex.getMonth() + 1).padStart(2, '0');
    }
    return MESES_ABBR[start.getMonth()] + '/' + String(start.getFullYear()).slice(-2);
  }
  /* Chave canônica de um período no mapa tarefa.realizado. Guardar DATA em vez
     do índice do bucket é o que faz a marca sobreviver a horizonte que cresceu,
     tarefa que mudou de data e troca de granularidade do projeto. */
  function periodoISO(key, unidade) {
    return isoOf(bucketStartDate(key, unidade));
  }
  /* Volta da chave canônica pro rótulo que a coluna mostra ("03/08", "ago/26").
     O caminho inverso do periodoISO, usado por quem tem só o ISO na mão (modal e
     painel do FCA por período): sem isto, o texto falaria de "2026-08-03" e a
     tabela de "03/08" pro mesmo período. */
  function periodoLabel(iso, unidade) {
    var d = parseISO(iso);
    if (!d) return iso || '';
    return bucketLabel(bucketKey(d, unidade), unidade);
  }
  /* "Semana 03/08" / "Mês ago/26" — o rótulo sozinho é ambíguo fora da tabela. */
  function periodoTitulo(iso, unidade) {
    return (unidade === 'semanas' ? 'Semana ' : 'Mês ') + periodoLabel(iso, unidade);
  }

  /* ---------- LÓGICA DE DOMÍNIO (pura, derivada) ---------- */
  function computeHorizonKeys(projeto, unidade) {
    var dates = [];
    (projeto.etapas || []).forEach(function (e) {
      (e.tarefas || []).forEach(function (t) {
        var ini = parseISO(t.inicio); if (ini) dates.push(ini);
        var fim = parseISO(t.fim); if (fim) dates.push(fim);
        var np = parseISO(t.novoPrazo); if (np) dates.push(np);
      });
    });
    // guard: dataRevisao e horizonte explícito SEMPRE entram na união, senão
    // o índice da linha de revisão pode cair fora do array de buckets.
    var rev = parseISO(projeto.dataRevisao); if (rev) dates.push(rev);
    var expI = parseISO(projeto.inicio); if (expI) dates.push(expI);
    var expF = parseISO(projeto.fim); if (expF) dates.push(expF);

    // horizonte pré-carregado: quantidade de buckets que o usuário pediu pra
    // exibir de antemão, antes mesmo de cadastrar etapas/tarefas. Só estende
    // o fim do horizonte — nunca encolhe o que já foi calculado pelas datas.
    var qtd = parseInt(projeto.horizonteQtd, 10);
    var qtdSpan = (qtd > 0) ? qtd - 1 : null;

    if (!dates.length) {
      // guard: projeto/etapa sem nenhuma tarefa — min/max sobre [] trava o
      // gerador de buckets. Usa o início explícito (se houver) ou hoje, e a
      // quantidade informada (ou uma janela default ao redor de hoje).
      var baseDate = expI || new Date();
      var startKey = bucketKey(baseDate, unidade);
      var span = qtdSpan != null ? qtdSpan : (unidade === 'semanas' ? 7 : 5);
      return { startKey: startKey, endKey: startKey + span };
    }
    var keys = dates.map(function (d) { return bucketKey(d, unidade); });
    var startKey = Math.min.apply(null, keys), endKey = Math.max.apply(null, keys);
    if (qtdSpan != null && (endKey - startKey) < qtdSpan) endKey = startKey + qtdSpan;
    return { startKey: startKey, endKey: endKey };
  }

  /* `override` (opcional) = {unidade, buckets, b0}. Força a granularidade e a
     grade de buckets em vez de derivá-las do projeto — é o que a visão de
     Ocupação usa pra cruzar vários projetos numa grade única, com a
     granularidade escolhida na tela. Sem `override`, cada projeto usa a sua
     própria `unidade` e o seu próprio horizonte (comportamento do Gantt).
     `R` continua derivado da `dataRevisao` DO PROJETO em qualquer caso — é o
     que mantém a cor de cada tarefa idêntica nas duas visões. */
  function computeProjectView(projeto, override) {
    var unidade = (override ? override.unidade : projeto.unidade) === 'semanas' ? 'semanas' : 'meses';
    var buckets, b0;
    if (override) {
      buckets = override.buckets;
      b0 = override.b0;
    } else {
      var hz = computeHorizonKeys(projeto, unidade);
      buckets = [];
      for (var k = hz.startKey; k <= hz.endKey; k++) buckets.push(k);
      b0 = hz.startKey;
    }
    var revD = parseISO(projeto.dataRevisao);
    var R = revD ? (bucketKey(revD, unidade) - b0) : null;

    function view(t) {
      var fimD = parseISO(t.fim);
      if (!fimD) return { invalida: true };
      var iniD = parseISO(t.inicio);
      var npD = parseISO(t.novoPrazo);
      var fimKey = bucketKey(fimD, unidade);
      var startKeyT = iniD ? bucketKey(iniD, unidade) : fimKey;
      var effEndKey = npD ? bucketKey(npD, unidade) : fimKey;
      var startIdx = startKeyT - b0, pEndIdx = fimKey - b0, effEndIdx = effEndKey - b0;
      /* ATRASO — o único fato que a página deriva sozinha.
         `atrasada` alimenta o KPI de Andamento e o aviso de FCA; `cor` é a
         leitura na tela, usada em dois lugares: a linha R do Gantt (ver
         realizadoAt, que une este fato às marcas declaradas) e as células da
         visão de Ocupação.

         ⚠ Comparação de DATAS, nunca de posição na grade. Antes isto era
         `effEndIdx <= R` (índice de bucket), e num projeto mensal toda tarefa
         que terminava no MESMO mês da revisão entrava como atrasada mesmo com
         o prazo ainda por vir — revisão 05/08 marcava atrasada uma tarefa com
         Fim 20/08. O prazo planejado é `Novo Prazo || Fim`: replanejar move a
         linha P, então é o Novo Prazo que passa a valer como prazo. */
      var prazoD = npD || fimD;
      var atrasada = !!(revD && t.status !== 'concluida' && revD > prazoD);
      /* ⚠ "Atrasada" é a ÚNICA cor automática da página (ago/2026). Daqui saíam
         outras quatro, todas removidas:
           · azul quando t.status==='concluida'
           · vermelho quando a tarefa tinha Novo Prazo
           · verde quando t.status==='em_andamento'
           · verde quando a tarefa "já devia ter começado" (startIdx <= R)
         Elas pintavam período que ninguém declarou — a página afirmava estado
         no lugar de quem lê o cronograma. Estado agora é DECLARAÇÃO: vem das
         marcas da linha R (ver realizadoAt). Atraso é FATO das datas, então
         segue automático.
         Se algum dia voltar uma leitura derivada, lembre que ela vale pras DUAS
         visões citadas acima — e que a legenda da Ocupação (crAlocLegend) e o
         "Como ler" (crAlocNote) hoje afirmam que lá só existe cinza e amarelo. */
      var cor = atrasada ? 'atrasada' : null;
      return { invalida: false, startIdx: startIdx, pEndIdx: pEndIdx, effEndIdx: effEndIdx, cor: cor, atrasada: atrasada, concluiLabel: bucketLabel(fimKey, unidade) };
    }

    return { unidade: unidade, buckets: buckets, b0: b0, R: R, view: view };
  }

  /* severidade das cores: quando várias tarefas caem no mesmo agregado (uma
     etapa, ou um bucket da visão de Ocupação), a pior vence. Escopo de módulo
     porque as duas visões precisam do MESMO critério. */
  var RANK = { reprogramada: 4, atrasada: 3, andamento: 2, futura: 1, concluida: 0 };
  function piorCor(a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return RANK[b] > RANK[a] ? b : a;
  }

  /* ---------- REALIZADO PERÍODO A PERÍODO ----------
     `tarefa.realizado` é um mapa {data-de-início-do-período: marca}. A marca é
     do mesmo vocabulário das cores derivadas (andamento/atrasada/
     reprogramada/concluida), então marca manual e leitura automática usam a
     mesma paleta e o mesmo piorCor().

     A chave é a data de INÍCIO do período (segunda-feira da semana, dia 1º do
     mês). Guardar data em vez do índice do bucket é o que faz a marca
     sobreviver a: horizonte que cresceu, tarefa que mudou de data, e troca de
     granularidade do projeto — a marca sempre cai no período que CONTÉM
     aquela data. Em visão mensal, as marcas das semanas de agosto colapsam no
     bucket de agosto e a pior vence. */
  function marcasPorIndice(t, pv) {
    var marcas = t.realizado;
    if (!marcas) return null;
    var keys = Object.keys(marcas);
    if (!keys.length) return null;          // null = "não tem marca", cai no automático
    var arr = new Array(pv.buckets.length);
    keys.forEach(function (iso) {
      var d = parseISO(iso); if (!d) return;
      /* revalida a marca aqui, e não só no normRealizado do load: o valor sai
         daqui direto pro atributo class (cr-c-<marca>), então o render não
         depende de nenhum caminho de entrada ter sanitizado antes. */
      if (MARCA_VALS.indexOf(marcas[iso]) < 0) return;
      var i = bucketKey(d, pv.unidade) - pv.b0;
      if (i < 0 || i >= arr.length) return; // marca fora do horizonte visível
      arr[i] = piorCor(arr[i], marcas[iso]);
    });
    return arr;
  }
  /* Marca do período mais recente que a tarefa tem marcado — data ISO ordena
     cronologicamente, então é a última chave. É ela que define o status da
     tarefa, pela mesma razão que quem lê o cronograma lê a célula pintada mais
     à direita: é o estado mais recente que alguém declarou. */
  function ultimaMarca(t) {
    var m = t && t.realizado;
    if (!m) return null;
    var keys = Object.keys(m).filter(function (k) { return MARCA_VALS.indexOf(m[k]) >= 0; }).sort();
    return keys.length ? m[keys[keys.length - 1]] : null;
  }
  /* `t.status` deixou de ser escolha própria (ago/2026): é CACHE do que as
     marcas dizem, regravado a cada clique em célula. Continua existindo porque
     é dele que saem o KPI de Conclusão, o "esconder concluídas" da Ocupação e o
     guard de "concluída não atrasa" em computeProjectView. O que ele NÃO faz
     mais é pintar: desde a remoção das cores automáticas, tarefa sem marca não
     ganha cor por causa do status guardado.
     Devolve null quando não há marca: nesse caso quem manda é o valor guardado. */
  function statusDeMarcas(t) {
    var u = ultimaMarca(t);
    if (!u) return null;
    return u === 'concluida' ? 'concluida' : 'em_andamento';
  }
  /* Estado do Realizado da tarefa, período a período — a UNIÃO de duas fontes:

       · as marcas manuais: o que alguém declarou naquele período;
       · o amarelo de atrasada: FATO das datas (Data de Revisão além do prazo
         planejado), a única leitura que a página deriva sozinha.

     ⚠ O fato VENCE a declaração "Em dia" (ago/2026). Até então as duas fontes
     eram exclusivas — havendo qualquer marca, o derivado era ignorado — e o
     resultado era uma tarefa com Fim em 31/07, marcada "Em dia" em julho e
     revisão em 15/08 aparecendo verde, contando como em dia no KPI. Pior: a
     visão de Ocupação lê `v.cor` direto e nunca soube de marcas, então já
     pintava essa mesma tarefa de amarelo — as duas telas discordavam sobre o
     mesmo fato, na mesma sessão.

     Vence só sobre 'andamento' e sobre célula VAZIA. 'concluida' e
     'reprogramada' ficam intactas de propósito: período declarado concluído não
     atrasa retroativamente, e 'reprogramada' já é a resposta ao atraso (além de
     vencer no RANK do piorCor, então sobrescrevê-la aqui contradiria o
     agregado da etapa).

     Célula vazia fora do intervalo planejado continua vazia: "célula pintada
     quer dizer que alguém declarou isto, ou que as datas denunciam atraso ali"
     — não "a tarefa existe".

     ⚠ Nada disto é gravado. O amarelo é recalculado a cada render a partir das
     datas, então aparece e SOME sozinho quando a tarefa é reprogramada ou a
     Data de Revisão volta atrás. Escrever o derivado em `t.realizado`
     transformaria abrir a página em alteração persistida no localStorage e congelaria um valor cujo sentido é acompanhar as datas. */
  function realizadoAt(t, v, pv) {
    var arr = marcasPorIndice(t, pv);
    var derivada = v.cor;                       // 'atrasada' ou null
    /* o intervalo do derivado vai até o Fim PLANEJADO, não até o Novo Prazo:
       quem o replanejamento move é a linha P (que ganha o trecho novo em cinza
       escuro), não a R. A linha R fala do intervalo que já estava previsto — e
       por isso também não tem tom escuro nenhum. */
    function noPlanejado(i) {
      return v.startIdx != null && i >= v.startIdx && i <= v.pEndIdx;
    }
    return {
      cor: function (i) {
        var m = arr ? arr[i] : null;
        if (derivada && (!m || m === 'andamento') && noPlanejado(i)) return derivada;
        return m || null;
      },
    };
  }
  /* Linha P da tarefa, célula por célula: o intervalo planejado até o Fim e,
     quando há Novo Prazo, o trecho acrescentado por ele em cinza escuro. É a
     mudança de tom que deixa o Fim original legível depois do replanejamento.
     Módulo, e não inline no render, porque a linha da ETAPA projeta as mesmas
     células — ter dois cálculos era garantia de as duas linhas divergirem. */
  function planejadoAt(v) {
    var extEnd = Math.max(v.pEndIdx, v.effEndIdx);
    return function (i) {
      if (v.startIdx == null || i < v.startIdx || i > extEnd) return null;
      return i > v.pEndIdx ? ['cr-c-p', 'cr-c-replan'] : ['cr-c-p'];
    };
  }
  /* A linha da etapa é a PROJEÇÃO das tarefas, célula por célula: marca só
     onde alguma tarefa tem célula formatada, com a pior cor vencendo no
     período. Antes era o intervalo min→max, que pintava também os períodos
     onde nenhuma tarefa existe (dois blocos de trabalho com um vão de 3 meses
     no meio viravam uma barra contínua). */
  function etapaCells(etapa, pv) {
    var n = pv.buckets.length;
    var P = new Array(n), R = new Array(n);   // P[i]: 'p' | 'replan' (extensão pelo Novo Prazo)
    (etapa.tarefas || []).forEach(function (t) {
      var v = pv.view(t);
      if (v.invalida) return;
      var pAt = planejadoAt(v);
      for (var i = 0; i < n; i++) {
        var cp = pAt(i);
        if (!cp) continue;
        /* claro vence escuro no agregado: o escuro quer dizer "período que só
           existe por causa do Novo Prazo", e isso deixa de ser verdade se
           qualquer outra tarefa da etapa já tinha trabalho planejado ali. */
        if (cp.length === 1) P[i] = 'p';
        else if (!P[i]) P[i] = 'replan';
      }
      var rz = realizadoAt(t, v, pv);
      for (var j = 0; j < n; j++) {
        var c = rz.cor(j);
        /* 'futura' fica de fora: é transparente na tarefa, e no agregado
           venceria 'concluida' no RANK — uma tarefa futura apagaria da etapa
           o azul de outra já concluída no mesmo período. */
        if (c && c !== 'futura') R[j] = piorCor(R[j], c);
      }
    });
    return { P: P, R: R };
  }

  /* "Atrasada" pro KPI de Andamento. Tem que concordar com o que a linha R
     mostra (realizadoAt), senão o KPI diria "100% em dia" com células amarelas
     na tela — contradição na mesma tela.

       · marca 'atrasada'   → atrasada, mesmo que as datas ainda não denunciem.
                              Declaração explícita vale por si: quem olhou o
                              cronograma sabe de algo que as datas não contam.
       · marca 'concluida'  → não atrasada (o guard de v.atrasada diz o mesmo).
       · qualquer outro caso → vale o FATO das datas (v.atrasada).

     ⚠ O terceiro caso inclui 'andamento' ("Em dia"), e é a correção de
     ago/2026: antes 'andamento' zerava o atraso, então bastava alguém ter
     marcado "Em dia" num período anterior pra uma tarefa de prazo vencido
     contar como em dia. 'reprogramada' também cai aqui, e continua correto —
     quem decide se o prazo furou é a data nova (v.atrasada compara com
     `Novo Prazo || Fim`), não a marca. */
  function atrasadaKPI(t, v) {
    var u = ultimaMarca(t);
    if (u === 'concluida') return false;
    if (u === 'atrasada') return true;
    return v.atrasada;
  }
  function projectKPIs(projeto, pv) {
    var total = 0, concluidas = 0, atrasadas = 0;
    (projeto.etapas || []).forEach(function (e) {
      (e.tarefas || []).forEach(function (t) {
        total++;
        var v = pv.view(t);
        if (v.invalida) return;
        if (t.status === 'concluida') concluidas++;   // t.status = cache da última marca
        if (atrasadaKPI(t, v)) atrasadas++;
      });
    });
    return {
      total: total, concluidas: concluidas, atrasadas: atrasadas,
      conclusaoPct: total ? Math.round(concluidas / total * 100) : null,
      andamentoPct: (total && pv.R != null) ? Math.round((total - atrasadas) / total * 100) : null,
    };
  }

  /* ---------- OCUPAÇÃO DA EQUIPE (domínio, puro) ----------
     Cruza TODOS os projetos considerados numa grade única pessoa × bucket.
     Duas leituras na mesma tabela:
       · sub-linha de projeto → presença binária: existe tarefa daquele
         projeto, daquela pessoa, planejada naquele bucket. Não é intensidade.
       · linha da pessoa → quantos projetos distintos marcaram aquele bucket.
         É a carga: "projetos simultâneos", teto praticável 2.
     ------------------------------------------------------------------ */

  /* horizonte único cobrindo todos os projetos considerados, na granularidade
     escolhida na tela. Reusa computeHorizonKeys por projeto (herda de graça os
     guards de projeto sem tarefa, dataRevisao e horizonteQtd) e une os extremos. */
  function computeGlobalHorizon(projetos, unidade) {
    var startKey = null, endKey = null;
    (projetos || []).forEach(function (p) {
      var hz = computeHorizonKeys(p, unidade);
      if (startKey == null || hz.startKey < startKey) startKey = hz.startKey;
      if (endKey == null || hz.endKey > endKey) endKey = hz.endKey;
    });
    if (startKey == null) {
      // nenhum projeto considerado (todos desmarcados): janela default ao redor
      // de hoje, mesmo fallback de computeHorizonKeys, pra grade não vir vazia.
      startKey = bucketKey(new Date(), unidade);
      endKey = startKey + (unidade === 'semanas' ? 7 : 5);
    }
    return { startKey: startKey, endKey: endKey };
  }

  /* chave de agrupamento: sem acento, sem caixa, espaços colapsados. Sem isso
     "Élida"/"Elida" e "rodrigo  ferreira" viram pessoas diferentes na grade. */
  function pessoaKey(nome) {
    return deaccent(nome).toLowerCase().replace(/\s+/g, ' ').trim();
  }
  var SEM_RESP = '(sem responsável)';
  var SEM_RESP_KEY = pessoaKey(SEM_RESP);
  /* a coluna "Resp." é texto livre e aceita "Rodrigo/Bruno".
     Divide pra tarefa compartilhada entrar na carga de cada um, em vez de criar
     uma pessoa fantasma chamada "Rodrigo/Bruno". O " e " é case-sensitive de
     propósito, pra não partir nomes tipo "Maria E Silva". */
  function splitResponsaveis(raw) {
    var nomes = String(raw || '').split(/\s*(?:\/|,|;|&|\se\s)\s*/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 1; });
    return nomes.length ? nomes : [SEM_RESP];
  }

  function buildAllocation(projetos, unidade, opts) {
    opts = opts || {};
    var hz = computeGlobalHorizon(projetos, unidade);
    var buckets = [];
    for (var k = hz.startKey; k <= hz.endKey; k++) buckets.push(k);
    var n = buckets.length, b0 = hz.startKey;

    /* Object.create(null), não {}: a chave vem de `tarefa.responsavel`, que é
       texto livre. Num objeto normal, um responsável chamado "__proto__" não
       criaria chave — gravaria no protótipo, e a pessoa desapareceria da grade
       (com `nome` undefined quebrando o localeCompare da ordenação). Mesmo
       cuidado que safeId() toma com id vindo de JSON importado. */
    var byKey = Object.create(null);   // pessoaKey -> { nomes:{grafia:contagem}, projetos:{pid:{cells}} }
    var semFim = [];   // tarefas sem data de Fim: ficam fora da conta, reportadas no rodapé

    (projetos || []).forEach(function (p) {
      // mesma unidade e mesma grade pra todos; R segue vindo da dataRevisao do
      // projeto, então a cor de cada tarefa bate com o Gantt dela.
      var pv = computeProjectView(p, { unidade: unidade, buckets: buckets, b0: b0 });
      (p.etapas || []).forEach(function (e) {
        (e.tarefas || []).forEach(function (t) {
          var v = pv.view(t);
          if (v.invalida) { semFim.push({ projeto: p.nome, tarefa: t.titulo || '(sem título)' }); return; }
          if (opts.hideDone && t.status === 'concluida') return;
          // a barra vai até max(fim, novoPrazo): é onde o trabalho vai
          // efetivamente consumir tempo da pessoa.
          var rawIni = v.startIdx, rawFim = Math.max(v.pEndIdx, v.effEndIdx);
          if (rawFim < 0 || rawIni > n - 1) return;             // fora da grade
          var ini = Math.max(0, rawIni), fim = Math.min(n - 1, rawFim);
          splitResponsaveis(t.responsavel).forEach(function (nome) {
            var pk = pessoaKey(nome) || SEM_RESP_KEY;
            var pess = byKey[pk] || (byKey[pk] = { key: pk, nomes: Object.create(null), projetos: Object.create(null) });
            pess.nomes[nome] = (pess.nomes[nome] || 0) + 1;
            var pr = pess.projetos[p.id] || (pess.projetos[p.id] = { id: p.id, nome: p.nome, cells: new Array(n) });
            var titulo = t.titulo || '(sem título)';
            for (var i = ini; i <= fim; i++) {
              var cur = pr.cells[i] || (pr.cells[i] = { cor: null, replan: false, tarefas: [] });
              cur.cor = piorCor(cur.cor, v.cor);
              // `tarefas` só alimenta o tooltip da célula — a leitura da grade
              // continua binária (presença), não intensidade. Dedupe por título
              // pra duas tarefas homônimas não virarem duas linhas iguais no balão.
              if (cur.tarefas.indexOf(titulo) < 0) cur.tarefas.push(titulo);
              if (i > v.pEndIdx) cur.replan = true;   // bucket que só existe por causa do Novo Prazo
            }
          });
        });
      });
    });

    var pessoas = Object.keys(byKey).map(function (pk) {
      var pess = byKey[pk];
      // a mesma pessoa pode estar escrita de formas diferentes em projetos
      // diferentes — exibe a grafia mais frequente.
      var nome = Object.keys(pess.nomes).sort(function (a, b) {
        return (pess.nomes[b] - pess.nomes[a]) || a.localeCompare(b, 'pt-BR');
      })[0];
      var projs = Object.keys(pess.projetos).map(function (id) { return pess.projetos[id]; });
      projs.sort(function (a, b) {
        var ai = a.cells.findIndex(Boolean), bi = b.cells.findIndex(Boolean);
        return (ai - bi) || a.nome.localeCompare(b.nome, 'pt-BR');
      });
      var load = [], pico = 0;
      for (var i = 0; i < n; i++) {
        var c = 0;
        projs.forEach(function (pr) { if (pr.cells[i]) c++; });
        load.push(c);
        if (c > pico) pico = c;
      }
      return { key: pk, nome: nome, projetos: projs, load: load, pico: pico };
    });
    pessoas.sort(function (a, b) {
      var aSem = a.key === SEM_RESP_KEY, bSem = b.key === SEM_RESP_KEY;
      if (aSem !== bSem) return aSem ? 1 : -1;      // "(sem responsável)" sempre por último
      return (b.pico - a.pico) || a.nome.localeCompare(b.nome, 'pt-BR');
    });

    var hojeD = parseISO(todayISO());
    var todayIdx = hojeD ? (bucketKey(hojeD, unidade) - b0) : null;
    if (todayIdx != null && (todayIdx < 0 || todayIdx > n - 1)) todayIdx = null;

    return { unidade: unidade, buckets: buckets, b0: b0, n: n, todayIdx: todayIdx, pessoas: pessoas, semFim: semFim };
  }

  function allocKPIs(aloc) {
    var sobrecarga = 0, topPico = 0, topNome = null;
    aloc.pessoas.forEach(function (pe) {
      pe.load.forEach(function (c) { if (c >= 3) sobrecarga++; });
      if (pe.pico > topPico) { topPico = pe.pico; topNome = pe.nome; }
    });
    return { pessoas: aloc.pessoas.length, sobrecarga: sobrecarga, topPico: topPico, topNome: topNome };
  }

  /* ---------- PERSISTÊNCIA ---------- */
  function emptyData() { return { version: 1, projetos: [] }; }
  /* Forma canonica do projeto: evita diferenca falsa quando o JSON vem em outra
     ordem de chaves. */
  /* Marcas de período do Realizado: {'YYYY-MM-DD': marca}. Sanitiza chave
     (data válida) e valor (marca conhecida) porque o payload pode vir de um
     JSON importado, de um localStorage antigo ou de outra versão
     da página.
     As chaves saem ORDENADAS de propósito: normalizeProjeto é a forma canônica
     do estado persistido. */
  function normRealizado(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).sort().forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !parseISO(k)) return;
      if (MARCA_VALS.indexOf(raw[k]) < 0) return;
      out[k] = raw[k];
    });
    return out;
  }
  /* ---------- FCA POR PERÍODO ----------
     Fato / Causa / Ação de UMA célula da linha R, guardado num mapa
     `tarefa.fcaPorPeriodo` com a MESMA chave do `realizado` (ISO do início do
     período). A chave compartilhada é deliberada: o FCA fala de um período
     declarado, então tem que reancorar junto com a marca quando o projeto troca
     de granularidade (meses ↔ semanas). Chave própria seria uma segunda regra
     pra manter alinhada com a primeira — e o dia em que divergissem, o FCA
     apareceria numa coluna e a marca em outra.

     Formato de cada entrada: {fato, causa, acao, editadoPor, editadoEm}.

     Entrada com os três campos em branco é descartada; carimbo sem conteúdo não
     é registro. */
  var FCA_CAMPOS = ['fato', 'causa', 'acao'];
  function fcaTexto(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function fcaVazio(e) {
    return !FCA_CAMPOS.some(function (k) { return fcaTexto(e && e[k]).trim() !== ''; });
  }
  /* Só o conteúdo, sem carimbo — é o que decide se o texto mudou. Usado pra
     decidir se o carimbo local sobrevive a um Aplicar. */
  function fcaConteudoIgual(a, b) {
    return FCA_CAMPOS.every(function (k) { return fcaTexto(a && a[k]) === fcaTexto(b && b[k]); });
  }
  function normFcaPeriodo(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).sort().forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !parseISO(k)) return;
      var e = raw[k];
      if (!e || typeof e !== 'object' || fcaVazio(e)) return;
      out[k] = {
        fato: fcaTexto(e.fato), causa: fcaTexto(e.causa), acao: fcaTexto(e.acao),
        /* teto de tamanho porque isto também chega por import de JSON editado à
           mão, e os dois entram no rodapé do modal e do painel — string
           quilométrica aqui esticaria o layout sem informar nada. */
        editadoPor: fcaTexto(e.editadoPor).slice(0, 150),
        editadoEm: fcaTexto(e.editadoEm).slice(0, 40),
      };
    });
    return out;
  }
  /* Períodos que PEDEM FCA e não têm: marca DECLARADA 'reprogramada' sem entrada
     preenchida. Só a declarada entra — o amarelo de "atrasada" que a página
     deriva das datas (ver realizadoAt) aparece e desaparece sozinho conforme a
     Data de Revisão anda, então cobrar FCA dele produziria pendência que nasce e
     morre sem ninguém ter mexido em nada. Reprogramar, ao contrário, é uma
     decisão humana registrada — e é dela que o FCA fala. */
  function fcaPendencias(p) {
    var out = [];
    ((p && p.etapas) || []).forEach(function (e) {
      (e.tarefas || []).forEach(function (t) {
        var marcas = t.realizado || {}, fcas = t.fcaPorPeriodo || {};
        Object.keys(marcas).sort().forEach(function (iso) {
          if (marcas[iso] !== 'reprogramada' || fcas[iso]) return;
          // normFcaPeriodo garante a equivalência "existe ⇒ tem conteúdo", então
          // a presença da chave basta como teste de preenchido.
          out.push({ etapaId: e.id, etapa: e.titulo, tarefaId: t.id, tarefa: t.titulo, iso: iso });
        });
      });
    });
    return out;
  }
  /* Todo FCA do projeto, ordenado por período — é o que o painel de leitura
     mostra. Inclui período que NÃO está reprogramado: nada impede registrar o
     FCA de um período marcado "Atrasada", e esconder o que alguém escreveu
     porque a marca não é a esperada seria pior que mostrar. */
  function fcaRegistros(p) {
    var out = [];
    ((p && p.etapas) || []).forEach(function (e) {
      (e.tarefas || []).forEach(function (t) {
        var fcas = t.fcaPorPeriodo || {};
        Object.keys(fcas).forEach(function (iso) {
          out.push({
            etapaId: e.id, etapa: e.titulo, tarefaId: t.id, tarefa: t.titulo, iso: iso,
            marca: (t.realizado || {})[iso] || '', fca: fcas[iso],
          });
        });
      });
    });
    out.sort(function (a, b) { return a.iso < b.iso ? -1 : (a.iso > b.iso ? 1 : 0); });
    return out;
  }
  function normalizeProjeto(p) {
    return {
      id: safeId(p.id),
      nome: p.nome || '(sem nome)',
      lider: p.lider || '',
      unidade: p.unidade === 'semanas' ? 'semanas' : 'meses',
      dataRevisao: p.dataRevisao || '',
      inicio: p.inicio || '',
      fim: p.fim || '',
      horizonteQtd: p.horizonteQtd || '',
      etapas: Array.isArray(p.etapas) ? p.etapas.map(function (e) {
        return {
          id: safeId(e.id),
          titulo: e.titulo || '(sem título)',
          tarefas: Array.isArray(e.tarefas) ? e.tarefas.map(function (t) {
            /* `realizado` é normalizado antes de derivar o status. */
            var realizado = normRealizado(t.realizado);
            var statusGuardado = ['nao_iniciada', 'em_andamento', 'concluida'].indexOf(t.status) >= 0 ? t.status : 'nao_iniciada';
            return {
              id: safeId(t.id),
              titulo: t.titulo || '(sem título)',
              responsavel: t.responsavel || '',
              inicio: t.inicio || '',
              fim: t.fim || '',
              /* Invariante: havendo período marcado, o status É a marca mais
                 recente. Reafirmado aqui pra valer em TODO caminho de entrada
                 (localStorage e import de JSON), inclusive
                 arquivo editado à mão — onde os dois poderiam vir
                 discordando e a tela mostraria uma coisa e o KPI outra. */
              status: statusDeMarcas({ realizado: realizado }) || statusGuardado,
              dataConclusaoReal: t.dataConclusaoReal || '',
              novoPrazo: t.novoPrazo || '',
              realizado: realizado,
              /* FCA é armazenado por período. */
              fcaPorPeriodo: normFcaPeriodo(t.fcaPorPeriodo),
              comentarios: t.comentarios || '',
            };
          }) : [],
        };
      }) : [],
    };
  }
  function normalizeData(payload) {
    var out = { version: 1, projetos: [] };
    if (payload && Array.isArray(payload.projetos)) {
      out.projetos = payload.projetos.map(function (p) { return normalizeProjeto(p); });
    }
    return out;
  }
  /* ---------- PERSISTÊNCIA LOCAL ----------
     O cronograma existe no navegador: DATA é o estado em memória e
     localStorage é a persistência. Cada alteração é salva imediatamente. */
  function saveData() {
    try {
      DATA = normalizeData(DATA);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA));
      return true;
    } catch (e) {
      console.warn('[cronograma] falha ao salvar localmente', e);
      toast('Não foi possível salvar o cronograma neste navegador.', true);
      return false;
    }
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return normalizeData(JSON.parse(raw));
    } catch (e) {
      console.warn('[cronograma] falha ao ler o cronograma local', e);
      return null;
    }
  }
  function loadData() {
    var local = loadLocal();
    if (local) { DATA = local; return Promise.resolve(); }
    /* Primeira visita (nada no localStorage ainda): carrega o exemplo e já
       salva, igual ao clique manual em "carregar exemplo" (crCarregarExemplo). */
    return fetch(DEMO_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) { DATA = normalizeData(d); saveData(); })
      .catch(function (e) {
        console.warn('[cronograma] falha ao carregar exemplo inicial', e);
        DATA = emptyData();
      });
  }

  /* ---------- MODAL / FORM (adaptado do gestao-alocacao.html, só os tipos usados aqui) ---------- */
  function getPath(obj, path) { return path.split('.').reduce(function (o, k) { return (o && o[k] != null) ? o[k] : undefined; }, obj); }
  function setPath(obj, path, val) {
    var keys = path.split('.'), cur = obj;
    for (var i = 0; i < keys.length - 1; i++) { var k = keys[i]; if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}; cur = cur[k]; }
    cur[keys[keys.length - 1]] = val;
  }
  function buildForm(fields, rec) {
    rec = rec || {};
    var wrap = document.createElement('div'); wrap.className = 'cr-form';
    var row = null, cnt = 0;
    function flush() { if (row) { wrap.appendChild(row); row = null; cnt = 0; } }
    fields.forEach(function (f) {
      var span = f.full ? 2 : 1;
      if (!row || cnt + span > 2) { flush(); row = document.createElement('div'); row.className = 'cr-frow' + (f.full ? ' one' : ''); cnt = 0; }
      var fld = document.createElement('div'); fld.className = 'cr-fld';
      if (f.full) fld.style.gridColumn = '1 / -1';
      var raw = getPath(rec, f.key);
      var val = raw != null ? raw : (f.default != null ? f.default : '');
      var h = '<label>' + esc(f.label) + (f.required ? ' *' : '') + '</label>';
      if (f.type === 'textarea') {
        h += '<textarea data-key="' + f.key + '">' + esc(val) + '</textarea>';
      } else if (f.type === 'select') {
        var opts = f.options || [];
        h += '<select data-key="' + f.key + '">' + opts.map(function (o) { return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(val) ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('') + '</select>';
      } else if (f.type === 'date') {
        h += '<input type="date" data-key="' + f.key + '" value="' + esc(val) + '">';
      } else if (f.type === 'number') {
        h += '<input type="number" min="1" step="1" data-key="' + f.key + '" value="' + esc(val) + '">';
      } else {
        h += '<input type="text" data-key="' + f.key + '" value="' + esc(val) + '">';
      }
      fld.innerHTML = h; row.appendChild(fld); cnt += span;
    });
    flush();
    return wrap;
  }
  function readForm(node, fields) {
    var out = {};
    fields.forEach(function (f) {
      var el = node.querySelector('[data-key="' + f.key + '"]');
      if (!el) return;
      setPath(out, f.key, (el.value || '').trim());
    });
    return out;
  }
  function openModal(title, bodyNode, actions) {
    document.getElementById('cr-mtitle').textContent = title;
    var mbody = document.getElementById('cr-mbody'); mbody.innerHTML = ''; mbody.appendChild(bodyNode);
    var act = document.getElementById('cr-mact'); act.innerHTML = '';
    (actions || [{ label: 'Fechar', cls: 'ghost', fn: closeModal }]).forEach(function (a) {
      var b = document.createElement('button'); b.className = 'cr-btn ' + a.cls; b.textContent = a.label; b.onclick = a.fn; act.appendChild(b);
    });
    document.getElementById('cr-modalbg').classList.add('show');
  }
  function closeModal() { document.getElementById('cr-modalbg').classList.remove('show'); }
  document.getElementById('cr-modalbg').addEventListener('click', function (e) { if (e.target.id === 'cr-modalbg') closeModal(); });

  /* ---------- OPÇÕES ---------- */
  var UNIDADE_OPTS = [{ v: 'meses', l: 'Meses' }, { v: 'semanas', l: 'Semanas' }];
  /* ÚNICO vocabulário de estado da página. É o status da tarefa, declarado
     período a período na linha R — o equivalente às marcas que podem ser importadas no JSON (D, A, R, C). A lista NÃO inclui "em branco":
     essa opção do menu grava '' e apaga a marca (ver crBucketClick), e não é
     valor válido de marca — MARCA_VALS é o filtro que protege o render.

     Do lado automático sobrou só o amarelo de "atrasada" (computeProjectView):
     marca declarada e esse único fato derivado se somam no piorCor() da etapa.

     Não existe mais uma lista separada de "status da tarefa": t.status (os 3
     valores internos) virou CACHE da última marca — ver statusDeMarcas(). */
  var MARCA_OPTS = [
    { v: 'andamento', l: 'Em dia' },
    { v: 'atrasada', l: 'Atrasada' },
    { v: 'reprogramada', l: 'Reprogramada' },
    { v: 'concluida', l: 'Concluída' },
  ];
  var MARCA_VALS = MARCA_OPTS.map(function (m) { return m.v; });
  var PROJ_FIELDS = [
    { key: 'nome', label: 'Nome do projeto', type: 'text', full: true, required: true },
    { key: 'lider', label: 'Líder', type: 'text' },
    { key: 'unidade', label: 'Unidade de tempo', type: 'select', options: UNIDADE_OPTS, default: 'meses' },
    { key: 'dataRevisao', label: 'Data de revisão', type: 'date' },
    { key: 'inicio', label: 'Início do horizonte (opcional)', type: 'date' },
    { key: 'fim', label: 'Fim do horizonte (opcional)', type: 'date' },
    { key: 'horizonteQtd', label: 'Qtd. de meses/semanas a pré-carregar (opcional)', type: 'number' },
  ];
  var ETAPA_FIELDS = [{ key: 'titulo', label: 'Título da etapa', type: 'text', full: true, required: true }];
  var TAREFA_FIELDS = [
    { key: 'titulo', label: 'Título da tarefa', type: 'text', full: true, required: true },
    { key: 'responsavel', label: 'Responsável', type: 'text' },
    /* Status NÃO é campo deste formulário (ago/2026): ele é declarado célula
       por célula na linha R do Gantt. Ter os dois lugares era pedir a mesma
       informação em dois vocabulários diferentes. */
    { key: 'inicio', label: 'Início', type: 'date' },
    { key: 'fim', label: 'Fim (planejado)', type: 'date', required: true },
    { key: 'dataConclusaoReal', label: 'Data de conclusão real', type: 'date' },
    { key: 'novoPrazo', label: 'Novo prazo (replanejamento)', type: 'date' },
    /* O FCA saiu deste formulário (ago/2026): ele agora pertence ao PERÍODO
       reprogramado, não à tarefa — clicar na célula da linha R é o caminho (ver
       crFcaPeriodo). Aqui ele respondia por uma tarefa inteira, então a segunda
       reprogramação apagava a explicação da primeira. */
    /* Texto livre, sem validação e sem efeito no cálculo do Gantt — só
       registro de contexto da tarefa (histórico, combinado, pendência). */
    { key: 'comentarios', label: 'Comentários', type: 'textarea', full: true },
  ];

  /* ---------- LOOKUPS ---------- */
  function findProjeto(id) { return DATA.projetos.find(function (p) { return p.id === id; }); }
  function findEtapa(etapaId) { var p = findProjeto(CUR_PROJ_ID); return p ? (p.etapas || []).find(function (e) { return e.id === etapaId; }) : null; }
  function findTarefa(etapaId, tarefaId) { var e = findEtapa(etapaId); return e ? (e.tarefas || []).find(function (t) { return t.id === tarefaId; }) : null; }
  function ensureCurrentProject() {
    if (!DATA.projetos.length) { CUR_PROJ_ID = null; return; }
    if (!DATA.projetos.some(function (p) { return p.id === CUR_PROJ_ID; })) CUR_PROJ_ID = DATA.projetos[0].id;
  }

  /* ---------- CRUD: PROJETO ---------- */
  window.crSelectProject = function (id) { CUR_PROJ_ID = id; render(); };
  window.crNovoProjeto = function () {
    if (!isEditable()) return;
    var form = buildForm(PROJ_FIELDS, { dataRevisao: todayISO() });
    openModal('Novo projeto', form, [
      { label: 'Cancelar', cls: 'ghost', fn: closeModal },
      { label: 'Criar', cls: 'primary', fn: function () { salvarProjeto(form, null); } },
    ]);
  };
  window.crEditarProjeto = function (id) {
    if (!isEditable()) return;
    var p = findProjeto(id); if (!p) return;
    var form = buildForm(PROJ_FIELDS, p);
    openModal('Editar projeto', form, [
      { label: 'Cancelar', cls: 'ghost', fn: closeModal },
      { label: 'Salvar', cls: 'primary', fn: function () { salvarProjeto(form, id); } },
    ]);
  };
  function salvarProjeto(form, existingId) {
    var vals = readForm(form, PROJ_FIELDS);
    if (!vals.nome) { toast('Nome do projeto é obrigatório.', true); return; }
    if (existingId) {
      var p = findProjeto(existingId);
      p.nome = vals.nome; p.lider = vals.lider; p.unidade = vals.unidade || 'meses';
      p.dataRevisao = vals.dataRevisao; p.inicio = vals.inicio; p.fim = vals.fim; p.horizonteQtd = vals.horizonteQtd;
    } else {
      var np = { id: uid(), nome: vals.nome, lider: vals.lider, unidade: vals.unidade || 'meses', dataRevisao: vals.dataRevisao, inicio: vals.inicio, fim: vals.fim, horizonteQtd: vals.horizonteQtd, etapas: [] };
      DATA.projetos.push(np); CUR_PROJ_ID = np.id;
    }
    closeModal(); saveData(); render();
  }
  window.crExcluirProjeto = function (id) {
    if (!isEditable()) return;
    var p = findProjeto(id); if (!p) return;
    if (!confirm('Excluir o projeto "' + p.nome + '" e todas as suas etapas/tarefas? Essa ação não pode ser desfeita.')) return;
    DATA.projetos = DATA.projetos.filter(function (x) { return x.id !== id; });
    if (CUR_PROJ_ID === id) CUR_PROJ_ID = DATA.projetos.length ? DATA.projetos[0].id : null;
    saveData(); render();
  };

  /* ---------- CRUD: ETAPA ---------- */
  window.crNovaEtapa = function (projId) {
    if (!isEditable()) return;
    var form = buildForm(ETAPA_FIELDS, {});
    openModal('Nova etapa', form, [
      { label: 'Cancelar', cls: 'ghost', fn: closeModal },
      {
        label: 'Criar', cls: 'primary', fn: function () {
          var vals = readForm(form, ETAPA_FIELDS);
          if (!vals.titulo) { toast('Título é obrigatório.', true); return; }
          var p = findProjeto(projId); p.etapas = p.etapas || [];
          p.etapas.push({ id: uid(), titulo: vals.titulo, tarefas: [] });
          closeModal(); saveData(); render();
        }
      },
    ]);
  };
  window.crEditarEtapa = function (etapaId) {
    if (!isEditable()) return;
    var e = findEtapa(etapaId); if (!e) return;
    var form = buildForm(ETAPA_FIELDS, e);
    openModal('Editar etapa', form, [
      { label: 'Cancelar', cls: 'ghost', fn: closeModal },
      {
        label: 'Salvar', cls: 'primary', fn: function () {
          var vals = readForm(form, ETAPA_FIELDS);
          if (!vals.titulo) { toast('Título é obrigatório.', true); return; }
          e.titulo = vals.titulo;
          closeModal(); saveData(); render();
        }
      },
    ]);
  };
  window.crExcluirEtapa = function (etapaId) {
    if (!isEditable()) return;
    var p = findProjeto(CUR_PROJ_ID), e = findEtapa(etapaId); if (!p || !e) return;
    if (!confirm('Excluir a etapa "' + e.titulo + '" e todas as suas tarefas?')) return;
    p.etapas = p.etapas.filter(function (x) { return x.id !== etapaId; });
    saveData(); render();
  };
  window.crToggleEtapa = function (etapaId) { COLLAPSED[etapaId] = !COLLAPSED[etapaId]; render(); };

  /* ---------- CRUD: TAREFA ---------- */
  window.crNovaTarefa = function (etapaId) {
    if (!isEditable()) return;
    var form = buildForm(TAREFA_FIELDS, {});
    openModal('Nova tarefa', form, [
      { label: 'Cancelar', cls: 'ghost', fn: closeModal },
      { label: 'Criar', cls: 'primary', fn: function () { salvarTarefa(form, etapaId, null); } },
    ]);
  };
  window.crEditarTarefa = function (etapaId, tarefaId) {
    if (!isEditable()) return;
    var t = findTarefa(etapaId, tarefaId); if (!t) return;
    var form = buildForm(TAREFA_FIELDS, t);
    var p = findProjeto(CUR_PROJ_ID);
    var pv = computeProjectView(p);
    var v = pv.view(t);
    /* Mesma regra do KPI: marca manual de "Atrasada" também pede FCA, senão o
       aviso só apareceria pra atraso que as datas denunciam.

       O aviso continua aqui — é onde quem está mexendo na tarefa atrasada está
       olhando — mas aponta pro caminho novo: com o FCA por período, este
       formulário não tem mais onde preenchê-lo. Sem essa frase o aviso mandaria
       preencher um campo que saiu da tela. */
    if (!v.invalida && atrasadaKPI(t, v)) {
      var warn = document.createElement('div');
      warn.className = 'cr-alert warn';
      warn.innerHTML = '<span class="material-symbols-outlined">warning</span>' +
        '<div>Tarefa atrasada — defina o <b>Novo Prazo</b> aqui, se aplicável, e registre o ' +
        '<b>FCA no período</b>: clique na célula da linha R do período reprogramado.</div>';
      form.insertBefore(warn, form.firstChild);
    }
    openModal('Editar tarefa', form, [
      { label: 'Cancelar', cls: 'ghost', fn: closeModal },
      { label: 'Excluir', cls: 'danger', fn: function () { closeModal(); window.crExcluirTarefa(etapaId, tarefaId); } },
      { label: 'Salvar', cls: 'primary', fn: function () { salvarTarefa(form, etapaId, tarefaId); } },
    ]);
  };
  function salvarTarefa(form, etapaId, existingId) {
    var vals = readForm(form, TAREFA_FIELDS);
    if (!vals.titulo) { toast('Título da tarefa é obrigatório.', true); return; }
    if (!vals.fim) { toast('Fim (planejado) é obrigatório.', true); return; }
    if (vals.novoPrazo && vals.novoPrazo <= vals.fim) { toast('Novo Prazo deve ser posterior ao Fim planejado.', true); return; }
    var e = findEtapa(etapaId); if (!e) return;
    e.tarefas = e.tarefas || [];
    var rec = { titulo: vals.titulo, responsavel: vals.responsavel, inicio: vals.inicio, fim: vals.fim, dataConclusaoReal: vals.dataConclusaoReal, novoPrazo: vals.novoPrazo, comentarios: vals.comentarios || '' };
    if (existingId) {
      var t = e.tarefas.find(function (x) { return x.id === existingId; });
      t.titulo = rec.titulo; t.responsavel = rec.responsavel; t.inicio = rec.inicio; t.fim = rec.fim;
      t.dataConclusaoReal = rec.dataConclusaoReal; t.novoPrazo = rec.novoPrazo; t.comentarios = rec.comentarios;
      /* t.status, t.realizado e t.fcaPorPeriodo NÃO são tocados: os três são
         declarados na linha R do Gantt, não neste formulário. Os três são
         ancorados em DATA, então sobrevivem a uma mudança de Fim / Novo Prazo da
         tarefa — inclusive o FCA, que continua apontando pro período em que a
         reprogramação foi declarada. */
    } else {
      rec.id = uid(); rec.status = 'nao_iniciada'; rec.realizado = {}; rec.fcaPorPeriodo = {}; e.tarefas.push(rec);
    }
    closeModal(); saveData(); render();
  }
  window.crExcluirTarefa = function (etapaId, tarefaId) {
    if (!isEditable()) return;
    var e = findEtapa(etapaId); if (!e) return;
    var t = e.tarefas.find(function (x) { return x.id === tarefaId; }); if (!t) return;
    if (!confirm('Excluir a tarefa "' + t.titulo + '"?')) return;
    e.tarefas = e.tarefas.filter(function (x) { return x.id !== tarefaId; });
    saveData(); render();
  };

  /* ---------- COMENTÁRIOS (leitura) ----------
     Sem guard de isEditable(): é exatamente o caso de uso — ler o comentário
     em modo apresentação ou como leitor, onde o modal de edição não abre.
     Não altera nada, então não chama saveData() nem render(). */
  window.crVerComentario = function (etapaId, tarefaId) {
    var t = findTarefa(etapaId, tarefaId); if (!t) return;
    var wrap = document.createElement('div');
    var cap = document.createElement('div');
    cap.className = 'cr-cmttitle';
    cap.textContent = t.titulo || '(sem título)';
    var body = document.createElement('div');
    body.className = 'cr-cmttext';
    /* textContent, não innerHTML: o comentário é texto livre digitado por
       gente e nunca deve ser interpretado como marcação. */
    body.textContent = t.comentarios || '';
    wrap.appendChild(cap); wrap.appendChild(body);
    openModal('Comentários', wrap, [{ label: 'Fechar', cls: 'ghost', fn: closeModal }]);
  };
  /* Prévia pro tooltip nativo do ícone. Comentário inteiro num title vira
     tarja gigante na tela (e o SO trunca do jeito que quiser) — quem mostra
     o texto completo, com as quebras de linha, é o modal. */
  function cmtPreview(s) {
    var t = String(s).replace(/\s+/g, ' ').trim();
    return (t.length > 160 ? t.slice(0, 160) + '…' : t) + ' — clique para ler';
  }

  /* ---------- FCA DO PERÍODO (modal) ----------
     UMA porta pras duas visões, decidindo o modo por isEditable():

       · modo edição      → formulário, aplica no que está na tela (+ rascunho)
       · apresentação/leitura → só leitura, sem guard de isEditable() na entrada

     A segunda metade é o requisito, não um extra: o FCA existe pra ser lido numa
     reunião de status, que é exatamente o momento em que a página está em modo
     apresentação e o modal de edição não abre. Mesmo motivo do crVerComentario.

     Aplicar aqui atualiza o cronograma e salva no localStorage, como o restante
     da página. */
  var FCA_LABELS = ['Fato', 'Causa', 'Ação'];
  var FCA_PERIODO_FIELDS = [
    { key: 'fato', label: 'Fato — o que aconteceu neste período', type: 'textarea', full: true },
    { key: 'causa', label: 'Causa — por que aconteceu', type: 'textarea', full: true },
    { key: 'acao', label: 'Ação — o que será feito a respeito', type: 'textarea', full: true },
  ];
  function marcaLabel(v) {
    var m = MARCA_OPTS.filter(function (o) { return o.v === v; })[0];
    return m ? m.l : '';
  }
  /* ISO persistido no JSON -> "05/08/2026 às 14:32" no fuso de quem lê. */
  function fmtIsoDataHora(iso) {
    if (!iso) return '';
    var d = new Date(String(iso));
    return isNaN(d.getTime()) ? '' : fmtDataHora(d.getTime());
  }
  /* Rodapé de autoria local do FCA. */
  function fcaCarimboTexto(e) {
    var quem = fcaTexto(e && e.editadoPor).trim();
    var quando = fmtIsoDataHora(e && e.editadoEm);
    if (!quem && !quando) return 'Registrado neste navegador.';
    return 'Última edição: ' + (quem || 'Edição local') + (quando ? (' · ' + quando) : '');
  }
  /* Um renderizador só pro conteúdo, usado pelo modal de leitura E pelo painel.
     Texto passa por esc() e o `.cr-cmttext` preserva as quebras de linha
     (white-space:pre-wrap) — o FCA é texto livre digitado por gente e nunca deve
     ser interpretado como marcação. */
  function fcaBlocoHTML(e) {
    return FCA_CAMPOS.map(function (k, i) {
      var txt = fcaTexto(e && e[k]).trim();
      return '<div class="cr-fcafield"><div class="cr-fcalabel">' + FCA_LABELS[i] + '</div>' +
        '<div class="cr-cmttext">' + (txt ? esc(txt) : '—') + '</div></div>';
    }).join('') + '<div class="cr-fcameta">' + esc(fcaCarimboTexto(e)) + '</div>';
  }
  window.crFcaPeriodo = function (etapaId, tarefaId, iso, oferecido) {
    var t = findTarefa(etapaId, tarefaId); if (!t) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    var p = findProjeto(CUR_PROJ_ID); if (!p) return;
    crCloseStatusDropdown();
    var unidade = p.unidade === 'semanas' ? 'semanas' : 'meses';
    var atual = (t.fcaPorPeriodo || {})[iso] || null;
    var marca = (t.realizado || {})[iso] || '';
    var wrap = document.createElement('div');
    var cap = document.createElement('div');
    cap.className = 'cr-cmttitle';
    cap.textContent = (t.titulo || '(sem título)') + ' · ' + periodoTitulo(iso, unidade) +
      (marca ? (' · ' + marcaLabel(marca)) : '');
    wrap.appendChild(cap);

    if (!isEditable()) {
      var leitura = document.createElement('div');
      leitura.innerHTML = atual ? fcaBlocoHTML(atual) :
        '<div class="cr-cmttext">Nenhum FCA registrado para este período.</div>';
      wrap.appendChild(leitura);
      openModal('FCA do período', wrap, [{ label: 'Fechar', cls: 'ghost', fn: closeModal }]);
      return;
    }

    if (oferecido) {
      /* O popup é OFERECIDO, não bloqueante: quem está classificando 20 células
         numa reunião não pode ser obrigado a escrever três parágrafos por
         célula. O preço é a pendência ficar visível na tabela — dizer isso aqui
         é o que impede a leitura "fechei, então não precisava". */
      var intro = document.createElement('div');
      intro.className = 'cr-alert warn';
      intro.innerHTML = '<span class="material-symbols-outlined">warning</span>' +
        '<div>Período marcado como <b>Reprogramada</b>. Registre o FCA para explicar o que ' +
        'aconteceu, por quê e o que será feito.<br><b>Pode fechar sem preencher</b> — o período ' +
        'fica sinalizado como pendente na tabela e no painel de FCA até alguém registrar.</div>';
      wrap.appendChild(intro);
    }
    var form = buildForm(FCA_PERIODO_FIELDS, atual || {});
    wrap.appendChild(form);
    if (atual) {
      var meta = document.createElement('div');
      meta.className = 'cr-fcameta';
      meta.textContent = fcaCarimboTexto(atual);
      wrap.appendChild(meta);
    }
    var acoes = [{ label: 'Cancelar', cls: 'ghost', fn: closeModal }];
    if (atual) {
      acoes.push({
        label: 'Limpar', cls: 'danger', fn: function () {
          if (t.fcaPorPeriodo) delete t.fcaPorPeriodo[iso];
          closeModal(); saveData(); render();
          toast('FCA do período removido e salvo neste navegador.');
        }
      });
    }
    acoes.push({
      label: 'Aplicar', cls: 'primary', fn: function () {
        var vals = readForm(form, FCA_PERIODO_FIELDS);
        var tem = !fcaVazio(vals);
        t.fcaPorPeriodo = t.fcaPorPeriodo || {};
        if (!tem) {
          delete t.fcaPorPeriodo[iso];      // três campos em branco = nada a registrar
        } else {
          /* Mantém o carimbo quando o texto não mudou; texto novo recebe carimbo local. */
          var manter = atual && fcaConteudoIgual(atual, vals);
          t.fcaPorPeriodo[iso] = {
            fato: vals.fato, causa: vals.causa, acao: vals.acao,
            editadoPor: manter ? atual.editadoPor : 'Edição local',
            editadoEm: manter ? atual.editadoEm : new Date().toISOString(),
          };
        }
        closeModal(); saveData(); render();
        toast(tem ? 'FCA do período registrado e salvo neste navegador.'
          : (atual ? 'FCA do período removido e salvo neste navegador.'
            : 'Nada registrado — os três campos estavam em branco.'));
      }
    });
    openModal('FCA do período', wrap, acoes);
  };

  /* ---------- CLIQUE NUMA CÉLULA DA LINHA "R" ----------
     Mini-dropdown inline, sem abrir o modal completo, com UMA lista: o status
     da tarefa NAQUELE período. Marcar a 1ª semana não pinta a 2ª — quem decide
     período a período é quem está olhando o cronograma, não a duração
     planejada.

     O status da tarefa inteira (t.status, que alimenta o KPI de Conclusão e o
     "esconder concluídas" da Ocupação) sai daqui por derivação: é a marca mais
     recente (statusDeMarcas).
     pra escolher o status separadamente — eram duas classificações da mesma
     coisa, em dois vocabulários, e a pessoa tinha que declarar duas vezes. */
  function crCloseStatusDropdown() {
    var el = document.getElementById('cr-statusdrop');
    if (el) el.remove();
    document.removeEventListener('click', crStatusDocClick);
  }
  function crStatusDocClick(e) {
    var el = document.getElementById('cr-statusdrop');
    if (el && !el.contains(e.target)) crCloseStatusDropdown();
  }
  window.crBucketClick = function (ev, etapaId, tarefaId, idx) {
    if (!isEditable()) return;
    ev.stopPropagation();
    var t = findTarefa(etapaId, tarefaId); if (!t) return;
    var p = findProjeto(CUR_PROJ_ID); if (!p) return;
    /* recalcula a grade em vez de guardar a do último render: o índice do
       bucket clicado só faz sentido junto com a granularidade e o b0 do
       momento, e um estado global aqui envelheceria calado. */
    var pv = computeProjectView(p);
    var key = pv.buckets[idx];
    if (key == null) return;
    var iso = periodoISO(key, pv.unidade);
    var marcas = t.realizado || {};
    var nMarcas = Object.keys(marcas).length;
    var alvo = '\'' + etapaId + '\',\'' + tarefaId + '\'';

    crCloseStatusDropdown();
    var rect = ev.currentTarget.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.id = 'cr-statusdrop';
    pop.className = 'cr-statusdrop';
    var html = '<div class="cr-statushdr">' +
      esc((pv.unidade === 'semanas' ? 'Semana ' : 'Mês ') + bucketLabel(key, pv.unidade)) + ' — status da tarefa</div>';
    /* "Em branco" é a primeira opção e aparece SEMPRE: é o estado zero do
       período e a saída pra desfazer uma classificação errada. Sempre visível
       (antes era um "Limpar este período" que só existia quando já havia marca)
       porque com ele na lista o menu mostra o estado atual em todos os casos —
       nenhuma marca = "Em branco" com o destaque de selecionado. Grava '', que
       o crMarcarPeriodo trata como delete. */
    html += '<div class="cr-statusopt' + (marcas[iso] ? '' : ' sel') + '" onclick="crMarcarPeriodo(' + alvo + ',\'' + iso + '\',\'\')">' +
      '<i class="cr-sw cr-sw-vazio"></i>Em branco (sem classificação)</div>';
    html += MARCA_OPTS.map(function (m) {
      return '<div class="cr-statusopt' + (marcas[iso] === m.v ? ' sel' : '') + '" onclick="crMarcarPeriodo(' + alvo + ',\'' + iso + '\',\'' + m.v + '\')">' +
        '<i class="cr-sw cr-c-' + m.v + '"></i>' + esc(m.l) + '</div>';
    }).join('');
    /* O FCA entra no MESMO menu da marca porque é a mesma pergunta vista de dois
       ângulos ("o que aconteceu neste período" / "por que aconteceu"), e porque
       este menu é o único caminho até uma célula. Aparece pra qualquer marca:
       nada impede registrar o FCA de um período "Atrasada", e o popup automático
       (só na reprogramação) cobre o caso comum, não todos. */
    var temFca = !!((t.fcaPorPeriodo || {})[iso]);
    html += '<div class="cr-statusopt cr-statusfca" onclick="crFcaPeriodo(' + alvo + ',\'' + iso + '\')">' +
      '<span class="material-symbols-outlined">fact_check</span>' +
      (temFca ? 'FCA deste período (preenchido)'
        : (marcas[iso] === 'reprogramada' ? 'FCA deste período (pendente)' : 'FCA deste período')) +
      '</div>';
    if (nMarcas) {
      html += '<div class="cr-statusopt" onclick="crLimparMarcas(' + alvo + ')">Limpar a tarefa inteira (' + nMarcas + ' período(s))</div>';
    }
    pop.innerHTML = html;
    // anexado dentro de #cr-root (não document.body) pra herdar as variáveis
    // CSS --cr-* — mesmo motivo do comentário sobre #cr-modalbg no HTML.
    document.getElementById('cr-root').appendChild(pop);
    /* posiciona só depois de medir: abrir sempre pra baixo jogaria o menu
       metade fora da tela numa tarefa do fim da tabela. */
    var h = pop.offsetHeight, w = pop.offsetWidth;
    var top = rect.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 4);
    pop.style.top = top + 'px';
    pop.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
    setTimeout(function () { document.addEventListener('click', crStatusDocClick); }, 0);
  };
  window.crMarcarPeriodo = function (etapaId, tarefaId, iso, marca) {
    if (!isEditable()) return;
    var t = findTarefa(etapaId, tarefaId); if (!t) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    t.realizado = t.realizado || {};
    if (marca && MARCA_VALS.indexOf(marca) >= 0) t.realizado[iso] = marca;
    else delete t.realizado[iso];        // '' = "Em branco", tira a classificação
    /* regrava o cache: sem isto, marcar a última semana como Concluída não
       mexeria no KPI de Conclusão nem esconderia a tarefa na Ocupação. Quando
       a última marca sai, o status volta a "não iniciada" — é o mesmo que
       "nada declarado", e daí a linha R fica vazia (só o amarelo de atrasada,
       que é fato das datas, continua aparecendo). */
    t.status = statusDeMarcas(t) || 'nao_iniciada';
    crCloseStatusDropdown();
    saveData(); render();
    /* Reprogramar é a única marca que decorre de uma DECISÃO com motivo, então é
       a única que abre o FCA sozinha. Depois do render de propósito: o modal vive
       em #cr-modalbg, que é irmão do #cr-body e sobrevive à remontagem — mas
       abrir antes deixaria a tabela atrás dele desatualizada por um instante.

       Oferecido, nunca bloqueante: quem já tem FCA registrado neste período não é
       interrompido de novo (a interrupção repetida é o que faz gente parar de
       ler o aviso), e quem fecha sem preencher deixa a pendência visível. */
    if (marca === 'reprogramada' && !((t.fcaPorPeriodo || {})[iso])) {
      window.crFcaPeriodo(etapaId, tarefaId, iso, true);
    }
  };
  window.crLimparMarcas = function (etapaId, tarefaId) {
    if (!isEditable()) return;
    var t = findTarefa(etapaId, tarefaId); if (!t) return;
    t.realizado = {};                    // sem marca nenhuma, a linha R fica vazia (ver realizadoAt)
    t.status = 'nao_iniciada';
    crCloseStatusDropdown();
    saveData(); render();
  };

  /* ---------- IMPORTAÇÃO / EXPORTAÇÃO JSON ----------
     O JSON é o formato de intercâmbio. Exportar tudo gera um backup completo
     do conteúdo local; exportar o projeto atual gera um arquivo menor para
     compartilhar ou mover apenas aquele projeto. */

  function baixarJSON(obj, nomeArquivo) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  /* nome de projeto -> nome de arquivo seguro (sem acento, sem espaço, sem
     caractere que o Windows recuse) */
  function slugArquivo(n) {
    var s = deaccent(String(n == null ? '' : n)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s.slice(0, 60) || 'projeto';
  }
  /* Chave de comparação de nome, usada só pra casar projeto do arquivo com
     projeto da tela quando o id não bate (arquivo vindo de outra página, ou
     projeto que foi recriado). Sem acento, sem caixa, espaço colapsado. */
  function nomeKey(n) { return deaccent(String(n == null ? '' : n)).trim().toLowerCase().replace(/\s+/g, ' '); }

  window.crExportarProjeto = function () {
    var p = findProjeto(CUR_PROJ_ID);
    if (!p) { toast('Nenhum projeto selecionado.', true); return; }
    baixarJSON({ version: 1, scope: 'projeto', projetos: [normalizeProjeto(p)] },
      'cronograma-' + slugArquivo(p.nome) + '.json');
  };

  window.crExportarTudo = function () {
    baixarJSON(normalizeData(DATA || emptyData()), 'cronogramas-projetos.json');
  };

  window.crExportarExemplo = function () {
    fetch(DEMO_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) { baixarJSON(normalizeData(d), 'cronogramas-projetos-exemplo.json'); })
      .catch(function (e) {
        console.warn('[cronograma] falha ao baixar exemplo', e);
        toast('Não foi possível baixar o JSON de exemplo.', true);
      });
  };

  window.crImportarArquivo = function (file) {
    if (!file || !isEditable()) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); } catch (e) { toast('JSON inválido.', true); return; }
      if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !Array.isArray(parsed.projetos)) {
        toast('Formato inesperado — esperado {version:1, projetos:[...]}.', true); return;
      }
      if (parsed.scope === 'projeto') {
        if (!parsed.projetos.length) { toast('O arquivo não tem nenhum projeto.', true); return; }
        if (parsed.projetos.length > 1) { toast('O arquivo tem ' + parsed.projetos.length + ' projetos — importe um por vez.', true); return; }
        abrirModalImportJSON(planejarImportJSON(parsed));
        return;
      }
      abrirModalImportTudo(parsed);
    };
    reader.readAsText(file);
  };

  function abrirModalImportTudo(parsed) {
    var novo = normalizeData(parsed);
    var nTarefas = novo.projetos.reduce(function (s, p) {
      return s + (p.etapas || []).reduce(function (ss, e) { return ss + ((e.tarefas || []).length); }, 0);
    }, 0);
    var body = document.createElement('div');
    body.innerHTML =
      '<div class="cr-impmeta">Este JSON tem <b>' + novo.projetos.length + '</b> projeto(s) e <b>' + nTarefas + '</b> tarefa(s).</div>' +
      '<div class="cr-alert warn"><span class="material-symbols-outlined">warning</span>' +
      '<div>Importar este arquivo substitui os cronogramas salvos neste navegador. Nada sai deste navegador.</div></div>';
    openModal('Importar cronogramas', body, [
      { label: 'Cancelar', cls: 'ghost', fn: closeModal },
      {
        label: 'Substituir dados locais', cls: 'primary', fn: function () {
          DATA = novo;
          ensureCurrentProject();
          closeModal();
          saveData();
          render();
          toast('Cronogramas importados e salvos neste navegador.');
        }
      },
    ]);
  }

  /* Decide o que o projeto do arquivo vai fazer com a tela ANTES de gravar
     qualquer coisa — o modal mostra o plano e o usuário confirma. É sempre
     MERGE: mexe só nesse projeto, e nenhum projeto da tela sai.

     Casa primeiro por id e depois por nome. Casando por nome, o id que
     PREVALECE é o da tela: id é a identidade do projeto aqui — as preferências
     da visão de Ocupação (ALOC_EXCL/ALOC_DECIDED) e o CUR_PROJ_ID são
     guardados por id, e trocar o id perderia tudo isso além de fazer o
     Isso preserva a identidade do projeto e as preferências locais associadas ao id. */
  function planejarImportJSON(parsed) {
    var itens = parsed.projetos.map(function (p) {
      var alvoId = null, via = 'novo';
      var porId = DATA.projetos.find(function (x) { return x.id === p.id; });
      if (porId) { alvoId = porId.id; via = 'id'; }
      else {
        var porNome = DATA.projetos.find(function (x) { return nomeKey(x.nome) === nomeKey(p.nome); });
        if (porNome) { alvoId = porNome.id; via = 'nome'; }
      }
      return { projeto: p, alvoId: alvoId, via: via };
    });
    return { itens: itens };
  }

  function abrirModalImportJSON(plano) {
    var body = document.createElement('div');
    var html = '<div class="cr-impmeta" style="margin-bottom:10px">' +
      '<b>Arquivo de um projeto.</b> Só o que está abaixo é alterado — os outros projetos da página não são tocados. ' +
      'A importação será salva apenas neste navegador.</div>';
    plano.itens.forEach(function (it, i) {
      var p = it.projeto;
      var nTarefas = (p.etapas || []).reduce(function (s, e) { return s + ((e.tarefas || []).length); }, 0);
      var alvo = it.alvoId ? findProjeto(it.alvoId) : null;
      var msg;
      if (it.via === 'id') msg = 'Atualiza o projeto <b>' + esc(alvo ? alvo.nome : '') + '</b> que já está na página.';
      else if (it.via === 'nome') msg = 'Mesmo nome do projeto <b>' + esc(alvo ? alvo.nome : '') + '</b> que já está na página.';
      else msg = 'Entra como <b>projeto novo</b>.';
      html += '<div class="cr-impcard">' +
        '<h4>' + esc(p.nome || '(sem nome)') + '</h4>' +
        '<div class="cr-impmeta">Líder <b>' + esc(p.lider || '—') + '</b>' +
        ' · Revisão <b>' + (p.dataRevisao ? fmtDateBR(p.dataRevisao) : '—') + '</b>' +
        ' · <b>' + ((p.etapas || []).length) + '</b> etapa(s) · <b>' + nTarefas + '</b> tarefa(s)</div>' +
        '<div class="cr-impmeta">' + msg + '</div>' +
        (it.via === 'nome' ?
          '<div class="cr-impdup"><label>O id não bate, mas o nome sim:</label>' +
          '<select data-alvo="' + i + '">' +
          '<option value="substituir">Substituir esse projeto</option>' +
          '<option value="novo">Importar como projeto novo (mantém o atual)</option>' +
          '</select></div>' : '') +
        '</div>';
    });
    body.innerHTML = html;
    openModal('Conferir antes de importar', body, [
      { label: 'Cancelar', cls: 'ghost', fn: closeModal },
      { label: 'Importar', cls: 'primary', fn: function () { aplicarImportJSON(plano, body); } },
    ]);
  }

  function aplicarImportJSON(plano, body) {
    if (!isEditable()) return;
    var ultimoId = null;
    var consumidos = Object.create(null);   // ids da tela que o arquivo assumiu
    var importados = [];

    plano.itens.forEach(function (it, i) {
      var p = normalizeProjeto(it.projeto);
      var alvoId = it.alvoId;
      if (it.via === 'nome') {
        var sel = body.querySelector('[data-alvo="' + i + '"]');
        if (sel && sel.value === 'novo') alvoId = null;
      }
      if (alvoId && DATA.projetos.some(function (x) { return x.id === alvoId; })) {
        p.id = alvoId;
        consumidos[alvoId] = true;
      }
      importados.push(p);
      ultimoId = p.id;
    });

    // substitui no lugar quem foi consumido (preserva a ordem da tela) e
    // acrescenta o que sobrou no fim
    var porId = Object.create(null);
    importados.forEach(function (p) { porId[p.id] = p; });
    var novos = importados.filter(function (p) { return !consumidos[p.id]; });
    DATA.projetos = DATA.projetos.map(function (x) { return porId[x.id] || x; }).concat(novos);

    DATA = normalizeData(DATA);  // sanitização final do JSON
    if (ultimoId) CUR_PROJ_ID = ultimoId;
    ensureCurrentProject();
    closeModal();
    saveData(); render();
    toast('Projeto importado e salvo neste navegador.');
  }

  window.crCarregarExemplo = function () {
    if (!isEditable()) return;
    fetch(DEMO_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) {
        DATA = normalizeData(d);
        ensureCurrentProject();
        saveData();
        render();
        toast('Exemplo carregado e salvo neste navegador.');
      })
      .catch(function (e) {
        console.warn('[cronograma] falha ao carregar exemplo', e);
        toast('Não foi possível carregar o exemplo.', true);
      });
  };

  /* ---------- RENDER ---------- */
  /* Uma linha de células de período. `clsAt(i)` devolve as classes de cor da
     célula i, ou null pra célula vazia — é essa indireção que permite pintar
     período a período (marcas manuais, projeção da etapa) em vez de só um
     intervalo contíguo. */
  /* `deco(i)` é opcional e serve pra decorar a célula sem duplicar este laço:
     devolve {cls:[...], onclick:'…', title:'…'} — hoje é o marcador de FCA da
     linha R das tarefas (ver crTarefaRows). O `onclick` dele só vale quando NÃO
     há `click`: em modo edição o clique pertence ao menu de marcar período, que
     já leva ao FCA por dentro; em apresentação/leitura não há menu, e é esse
     onclick que se torna a única porta pro FCA — que é o requisito de ele ser
     legível numa reunião de status. O `title`, quando vem, vence o genérico. */
  function periodCells(n, R, clsAt, click, deco) {
    var out = '';
    for (var i = 0; i < n; i++) {
      var cls = ['cr-bcell'];
      var extra = clsAt(i);
      if (extra) for (var j = 0; j < extra.length; j++) cls.push(extra[j]);
      if (i === R) cls.push('cr-revcol');
      var d = deco ? deco(i) : null;
      if (d && d.cls) for (var k = 0; k < d.cls.length; k++) cls.push(d.cls[k]);
      var attrs = '';
      if (click) {
        cls.push('cr-bcell-click');
        attrs = ' onclick="crBucketClick(event,\'' + click.etapaId + '\',\'' + click.tarefaId + '\',' + i + ')"' +
          ' title="' + esc((d && d.title) || 'Clique para marcar este período') + '"';
      } else if (d && d.onclick) {
        cls.push('cr-bcell-click');
        attrs = ' onclick="' + d.onclick + '" title="' + esc(d.title || '') + '"';
      }
      out += '<td class="' + cls.join(' ') + '"' + attrs + '></td>';
    }
    return out;
  }
  function crEmptyState() {
    return '<div class="cr-empty"><p>Nenhum projeto cadastrado ainda.</p>' +
      (isEditable() ?
        '<div class="cr-emptyactions">' +
        '<button class="cr-btn primary" onclick="crNovoProjeto()"><span class="material-symbols-outlined">add</span>Novo projeto</button>' +
        '<label class="cr-btn ghost cr-filelabel">' +
        '<span class="material-symbols-outlined">upload</span>Importar JSON' +
        '<input type="file" accept=".json,application/json" onchange="crImportarArquivo(this.files[0]); this.value=\'\';">' +
        '</label>' +
        '<button class="cr-btn ghost" onclick="crCarregarExemplo()"><span class="material-symbols-outlined">science</span>Carregar demo</button>' +
        '<button class="cr-btn ghost" onclick="crExportarExemplo()"><span class="material-symbols-outlined">download</span>Baixar JSON demo</button>' +
        '</div>'
        : '<p>Crie um projeto ou importe um arquivo JSON.</p>') +
      '</div>';
  }
  function crProjectHeader(p) {
    return '<div class="cr-projhead"><div><h2>' + esc(p.nome) + '</h2><div class="cr-projmeta">' +
      (p.lider ? ('Líder: ' + esc(p.lider)) : '') +
      '</div></div>' +
      (isEditable() ? '<div class="cr-projactions">' +
        '<button class="cr-btn ghost sm" onclick="crEditarProjeto(\'' + p.id + '\')"><span class="material-symbols-outlined">edit</span>Editar</button>' +
        '<button class="cr-btn danger sm" onclick="crExcluirProjeto(\'' + p.id + '\')"><span class="material-symbols-outlined">delete</span>Excluir</button>' +
        '</div>' : '') +
      '</div>';
  }
  function crKpiRow(p, pv, kpi) {
    var revLabel = p.dataRevisao ? fmtDateBR(p.dataRevisao) : 'Não definida';
    return '<div class="cr-kpirow">' +
      '<div class="cr-kpi' + (isEditable() ? ' cr-clickable' : '') + '"' + (isEditable() ? (' onclick="crEditarProjeto(\'' + p.id + '\')"') : '') + '>' +
      '<div class="cr-kpik">Data de Revisão</div><div class="cr-kpiv">' + esc(revLabel) + '</div></div>' +
      '<div class="cr-kpi"><div class="cr-kpik">Andamento</div><div class="cr-kpiv">' + (kpi.andamentoPct == null ? '—' : kpi.andamentoPct + '%') + '</div></div>' +
      '<div class="cr-kpi"><div class="cr-kpik">Conclusão</div><div class="cr-kpiv">' + (kpi.conclusaoPct == null ? '—' : kpi.conclusaoPct + '%') + '</div></div>' +
      '</div>' +
      (pv.R == null ? '<div class="cr-alert warn"><span class="material-symbols-outlined">warning</span>Defina a Data de Revisão do projeto para calcular atrasos (Andamento).</div>' : '');
  }
  /* Ações de dados: importar e exportar arquivos JSON.
     A persistência normal acontece automaticamente no localStorage. */
  function crActionsBar(p) {
    if (!isEditable()) return '';
    return '<div class="cr-actionsbar">' +
      '<button class="cr-btn primary sm" onclick="crNovaEtapa(\'' + p.id + '\')"><span class="material-symbols-outlined">add</span>Etapa</button>' +
      '<button class="cr-btn ghost sm" onclick="crExportarTudo()"><span class="material-symbols-outlined">download</span>Exportar tudo</button>' +
      '<button class="cr-btn ghost sm" onclick="crExportarProjeto()"><span class="material-symbols-outlined">download</span>Exportar projeto</button>' +
      '<button class="cr-btn ghost sm" onclick="crExportarExemplo()"><span class="material-symbols-outlined">science</span>Baixar JSON demo</button>' +
      '<label class="cr-btn ghost sm cr-filelabel">' +
      '<span class="material-symbols-outlined">upload</span>Importar JSON' +
      '<input type="file" accept=".json,application/json" onchange="crImportarArquivo(this.files[0]); this.value=\'\';">' +
      '</label>' +
      '</div>';
  }
  /* Aviso de pendência: fica no bloco fixo, junto dos KPIs, porque é informação
     de estado do projeto — não uma ação. Aparece só quando há pendência, e o
     texto diz a consequência (cronograma sem memória do motivo), não só a
     contagem: contagem sozinha vira número que se aprende a ignorar. */
  function crFcaAlert(p) {
    var pend = fcaPendencias(p);
    if (!pend.length) return '';
    var um = pend[0];
    return '<div class="cr-alert warn"><span class="material-symbols-outlined">warning</span><div>' +
      '<b>' + pend.length + (pend.length === 1 ? ' período reprogramado sem FCA' : ' períodos reprogramados sem FCA') +
      '</b> neste projeto — a data mudou e o cronograma não guarda por quê. ' +
      'Os períodos estão marcados com <b>!</b> na linha R.' +
      (isEditable() ?
        ' <button class="cr-btn ghost sm" onclick="crFcaPeriodo(\'' + um.etapaId + '\',\'' + um.tarefaId + '\',\'' + um.iso + '\',true)">' +
        '<span class="material-symbols-outlined">fact_check</span>Registrar o primeiro</button>' : '') +
      '</div></div>';
  }
  /* Painel de leitura do FCA — o artefato que se lê em voz alta numa reunião de
     status, e a razão de ele viver DENTRO do bloco fixo: a altura da tabela é
     calculada a partir do rodapé desse bloco (syncTableMaxHeight), então abrir o
     painel devolve espaço automaticamente em vez de empurrar a tabela pra fora
     da tela. Colapsado ocupa uma linha.

     Renderiza nas DUAS visões, em edição ou apresentação: em apresentação é
     o único lugar que mostra o texto do FCA sem precisar clicar célula por
     célula. Pendências primeiro — são as que pedem ação. */
  function crFcaPanel(p, pv) {
    var regs = fcaRegistros(p), pend = fcaPendencias(p);
    if (!regs.length && !pend.length) return '';
    var partes = [];
    if (regs.length) partes.push(regs.length + (regs.length === 1 ? ' registro' : ' registros'));
    if (pend.length) partes.push(pend.length + (pend.length === 1 ? ' pendente' : ' pendentes'));
    function cabeca(r, tag) {
      return '<div class="cr-fcahead">' +
        '<span class="cr-fcaper">' + esc(periodoTitulo(r.iso, pv.unidade)) + '</span>' +
        (tag ? '<span class="cr-fcatag cr-c-' + tag + '">' + esc(marcaLabel(tag)) + '</span>' : '') +
        '<span class="cr-fcatarefa">' + esc(r.etapa) + ' › ' + esc(r.tarefa) + '</span>' +
        (isEditable() ?
          '<button class="cr-iconbtn" title="Abrir o FCA deste período" ' +
          'onclick="crFcaPeriodo(\'' + r.etapaId + '\',\'' + r.tarefaId + '\',\'' + r.iso + '\')">' +
          '<span class="material-symbols-outlined">edit</span></button>' : '') +
        '</div>';
    }
    var lista =
      pend.map(function (r) {
        return '<div class="cr-fcaitem cr-fcaitem-pend">' + cabeca(r, 'reprogramada') +
          '<div class="cr-fcameta">Sem FCA registrado.</div></div>';
      }).join('') +
      regs.map(function (r) {
        return '<div class="cr-fcaitem">' + cabeca(r, r.marca) + fcaBlocoHTML(r.fca) + '</div>';
      }).join('');
    return '<details class="cr-fcapanel"' + (FCA_PANEL_OPEN ? ' open' : '') + ' ontoggle="crFcaPanelToggle(this)">' +
      '<summary><span class="material-symbols-outlined">fact_check</span>FCA por período — ' + esc(partes.join(' · ')) + '</summary>' +
      '<div class="cr-fcalist">' + lista + '</div></details>';
  }
  function crLegend() {
    return '<div class="cr-legend">' +
      '<span><i style="background:var(--cr-gray-p)"></i>Planejado (P)</span>' +
      '<span><i style="background:var(--cr-green)"></i>Em dia</span>' +
      '<span><i style="background:var(--cr-yellow)"></i>Atrasada</span>' +
      '<span><i style="background:var(--cr-red)"></i>Reprogramada</span>' +
      '<span><i style="background:var(--cr-blue)"></i>Concluída</span>' +
      '<span><i style="background:var(--cr-gray-p-dark)"></i>Replanejado (novo P)</span>' +
      '<span><i style="background:var(--cr-red);width:3px;height:14px;border-radius:0"></i>Linha de revisão</span>' +
      '</div>' + crHintLine();
  }
  /* Uma linha, porque ela entra no bloco fixo e cada pixel aqui sai da altura
     da tabela. Duas dicas só, as duas sem outra pista na tela:

       · o amarelo automático (ago/2026) aparece SOBRE uma célula marcada "Em
         dia", e sem esta frase quem marcou lê isso como bug da página;
       · a alça de arraste da coluna é invisível de propósito (ver .cr-rsz). */
  function crHintLine() {
    return '<div class="cr-hintline"></div>';
  }
  function crTarefaRows(etapa, t, ei, ti, pv) {
    var v = pv.view(t);
    var n = pv.buckets.length;
    var numLabel = (ei + 1) + '.' + (ti + 1);
    var editBtns = isEditable() ?
      ' <button class="cr-iconbtn" title="Editar tarefa" onclick="crEditarTarefa(\'' + etapa.id + '\',\'' + t.id + '\')"><span class="material-symbols-outlined">edit</span></button>'
      : '';
    /* Vem antes de editBtns pra ficar sempre na mesma posição relativa ao
       título, independente de o modo permitir edição ou não. */
    var cmt = String(t.comentarios || '').trim();
    var cmtBtn = cmt ?
      ' <button class="cr-iconbtn cr-cmtbtn" title="' + esc(cmtPreview(cmt)) + '" onclick="event.stopPropagation();crVerComentario(\'' + etapa.id + '\',\'' + t.id + '\')"><span class="material-symbols-outlined">chat_bubble</span></button>'
      : '';
    if (v.invalida) {
      return '<tr class="cr-tarefa-row cr-invalida">' +
        '<td class="cr-col-num">' + numLabel + '</td>' +
        '<td class="cr-col-titulo">' + esc(t.titulo || '(sem título)') + cmtBtn + editBtns + '</td>' +
        '<td class="cr-col-resp">' + esc(t.responsavel || '') + '</td>' +
        '<td class="cr-col-inicio">' + (t.inicio ? fmtDateBR(t.inicio) : '—') + '</td>' +
        '<td class="cr-col-fim">—</td><td class="cr-col-novoprazo">—</td><td class="cr-col-conclusao">—</td>' +
        '<td class="cr-col-pr">—</td>' +
        '<td colspan="' + n + '" class="cr-warncell">⚠ Sem data de Fim — edite a tarefa pra completar o cronograma.</td>' +
        '<td class="cr-spacer"></td>' +
        '</tr>';
    }
    var barP = periodCells(n, pv.R, planejadoAt(v));
    var rz = realizadoAt(t, v, pv);
    var clickOpts = isEditable() ? { etapaId: etapa.id, tarefaId: t.id } : null;
    /* Marcador de FCA na própria célula: é onde a informação pertence, e é o que
       torna a pendência visível sem obrigar ninguém a abrir painel nenhum. Lê o
       DECLARADO (t.realizado), não a cor derivada — a mesma razão de
       fcaPendencias só cobrar FCA de reprogramação: o amarelo automático vai e
       volta com a Data de Revisão, e um "!" que pisca sozinho na tabela ensina a
       ignorar o marcador. */
    var fcasT = t.fcaPorPeriodo || {};
    var marcasT = t.realizado || {};
    var alvoT = '\'' + etapa.id + '\',\'' + t.id + '\'';
    var barR = periodCells(n, pv.R, function (i) {
      var c = rz.cor(i);
      return c ? ['cr-c-' + c] : null;
    }, clickOpts, function (i) {
      var key = pv.buckets[i]; if (key == null) return null;
      var iso = periodoISO(key, pv.unidade);
      var tem = !!fcasT[iso];
      var pend = !tem && marcasT[iso] === 'reprogramada';
      if (!tem && !pend) return null;
      return {
        cls: [tem ? 'cr-fca-ok' : 'cr-fca-pend'],
        onclick: 'event.stopPropagation();crFcaPeriodo(' + alvoT + ',\'' + iso + '\')',
        title: tem ? ('FCA registrado neste período — clique para ' + (isEditable() ? 'editar' : 'ler'))
          : 'Reprogramada sem FCA registrado — clique para registrar',
      };
    });
    return '<tr class="cr-tarefa-row">' +
      '<td class="cr-col-num" rowspan="2">' + numLabel + '</td>' +
      '<td class="cr-col-titulo" rowspan="2">' + esc(t.titulo || '(sem título)') + cmtBtn + editBtns + '</td>' +
      '<td class="cr-col-resp" rowspan="2">' + esc(t.responsavel || '') + '</td>' +
      '<td class="cr-col-inicio" rowspan="2">' + (t.inicio ? fmtDateBR(t.inicio) : '—') + '</td>' +
      '<td class="cr-col-fim" rowspan="2">' + fmtDateBR(t.fim) + '</td>' +
      '<td class="cr-col-novoprazo" rowspan="2">' + (t.novoPrazo ? fmtDateBR(t.novoPrazo) : '—') + '</td>' +
      '<td class="cr-col-conclusao" rowspan="2">' + esc(v.concluiLabel) + '</td>' +
      '<td class="cr-col-pr">P</td>' + barP + '<td class="cr-spacer"></td>' +
      '</tr><tr class="cr-tarefa-row"><td class="cr-col-pr">R</td>' + barR + '<td class="cr-spacer"></td></tr>';
  }
  function crEtapaRows(etapa, ei, pv) {
    var collapsed = !!COLLAPSED[etapa.id];
    var n = pv.buckets.length;
    var cells = etapaCells(etapa, pv);
    var barP = periodCells(n, pv.R, function (i) {
      if (!cells.P[i]) return null;
      return cells.P[i] === 'replan' ? ['cr-c-p', 'cr-c-replan'] : ['cr-c-p'];
    });
    var barR = periodCells(n, pv.R, function (i) { return cells.R[i] ? ['cr-c-' + cells.R[i]] : null; });
    var caret = collapsed ? 'chevron_right' : 'expand_more';
    var editBtns = isEditable() ?
      ' <button class="cr-iconbtn" title="Nova tarefa" onclick="event.stopPropagation();crNovaTarefa(\'' + etapa.id + '\')"><span class="material-symbols-outlined">add</span></button>' +
      '<button class="cr-iconbtn" title="Editar etapa" onclick="event.stopPropagation();crEditarEtapa(\'' + etapa.id + '\')"><span class="material-symbols-outlined">edit</span></button>' +
      '<button class="cr-iconbtn danger" title="Excluir etapa" onclick="event.stopPropagation();crExcluirEtapa(\'' + etapa.id + '\')"><span class="material-symbols-outlined">delete</span></button>'
      : '';
    var head =
      '<tr class="cr-etapa-row" onclick="crToggleEtapa(\'' + etapa.id + '\')">' +
      '<td class="cr-col-num" rowspan="2">' + (ei + 1) + '</td>' +
      '<td class="cr-col-titulo" rowspan="2"><span class="material-symbols-outlined cr-caret">' + caret + '</span>' + esc(etapa.titulo) + editBtns + '</td>' +
      '<td class="cr-col-resp" rowspan="2"></td><td class="cr-col-inicio" rowspan="2"></td><td class="cr-col-fim" rowspan="2"></td>' +
      '<td class="cr-col-novoprazo" rowspan="2"></td><td class="cr-col-conclusao" rowspan="2"></td>' +
      '<td class="cr-col-pr">P</td>' + barP + '<td class="cr-spacer"></td>' +
      '</tr>' +
      '<tr class="cr-etapa-row" onclick="crToggleEtapa(\'' + etapa.id + '\')"><td class="cr-col-pr">R</td>' + barR + '<td class="cr-spacer"></td></tr>';
    var kids = '';
    (etapa.tarefas || []).forEach(function (t, ti) { kids += crTarefaRows(etapa, t, ei, ti, pv); });
    if (!(etapa.tarefas || []).length) {
      kids = '<tr><td colspan="' + (8 + n) + '" class="cr-emptyrow">Sem tarefas nesta etapa.' + (isEditable() ? ' Use o ícone "+" acima.' : '') + '</td><td class="cr-spacer"></td></tr>';
    }
    return '<tbody class="cr-etapa-group">' + head + '</tbody>' +
      '<tbody class="cr-tasks-group" style="' + (collapsed ? 'display:none' : '') + '">' + kids + '</tbody>';
  }
  function crGanttWrap(p, pv) {
    var n = pv.buckets.length;
    var headCols = pv.buckets.map(function (k, i) {
      return '<th class="cr-bucket' + (i === pv.R ? ' cr-revcol' : '') + '">' + esc(bucketLabel(k, pv.unidade)) + rszHandle('periodo') + '</th>';
    }).join('');
    var body = '';
    (p.etapas || []).forEach(function (etapa, ei) { body += crEtapaRows(etapa, ei, pv); });
    if (!(p.etapas || []).length) {
      body = '<tbody><tr><td colspan="' + (8 + n) + '" class="cr-emptyrow">Nenhuma etapa ainda.' + (isEditable() ? ' Use "+ Etapa" acima.' : '') + '</td><td class="cr-spacer"></td></tr></tbody>';
    }
    return '<div class="cr-ganttwrap"><table class="cr-gantt">' + colgroupHTML(GANTT_LEAD, n) + '<thead><tr>' +
      '<th class="cr-col-num">Nº' + rszHandle('num') + '</th>' +
      '<th class="cr-col-titulo">Etapa / Tarefa' + rszHandle('titulo') + '</th>' +
      '<th class="cr-col-resp">Resp.' + rszHandle('resp') + '</th>' +
      '<th class="cr-col-inicio">Início' + rszHandle('inicio') + '</th>' +
      '<th class="cr-col-fim">Fim' + rszHandle('fim') + '</th>' +
      '<th class="cr-col-novoprazo">Novo Prazo' + rszHandle('novoprazo') + '</th>' +
      '<th class="cr-col-conclusao">Conclusão' + rszHandle('conclusao') + '</th>' +
      '<th class="cr-col-pr">P/R' + rszHandle('pr') + '</th>' + headCols +
      '<th class="cr-spacer"></th></tr></thead>' + body + '</table></div>';
  }
  /* ---------- RENDER: OCUPAÇÃO DA EQUIPE ----------
     Os onclick daqui passam ÍNDICES, nunca a chave de pessoa: a chave vem de
     `tarefa.responsavel`, que é texto livre, e esc() não protege contexto de
     atributo/JS-string (ver comentário em safeId). LAST_ALOC resolve o índice. */
  var LAST_ALOC = null;

  function alocProjetosConsiderados() {
    return (DATA.projetos || []).filter(function (p) { return !ALOC_EXCL[p.id]; });
  }
  /* Projeto "[PROPOSTA] X" é cópia de um projeto existente (replanejamento pra
     levar a outro líder) — somado ao original, contaria a MESMA tarefa duas
     vezes e dobraria a carga. Então entra desmarcado por default. Roda a cada
     render da visão em vez de só no init, pra pegar também projeto que chegou
     por importação de JSON no meio da sessão. Escolha explícita do
     usuário (ALOC_DECIDED) sempre vence o default. */
  function seedAlocDefaults() {
    var mudou = false;
    (DATA.projetos || []).forEach(function (p) {
      if (ALOC_DECIDED[p.id]) return;
      if (/^\s*\[PROPOSTA\]/i.test(String(p.nome || '')) && !ALOC_EXCL[p.id]) {
        ALOC_EXCL[p.id] = true; mudou = true;
      }
    });
    if (mudou) lsSet(ALOC_EXCL_KEY, ALOC_EXCL);
  }
  function crAlocTools() {
    var projs = DATA.projetos || [];
    var inc = projs.filter(function (p) { return !ALOC_EXCL[p.id]; }).length;
    return '<div class="cr-aloctools">' +
      '<div class="cr-alocfield"><label>Granularidade</label><div class="cr-segc">' +
      '<button class="' + (ALOC_UNIDADE === 'semanas' ? 'active' : '') + '" onclick="crAlocSetUnidade(\'semanas\')">Semanal</button>' +
      '<button class="' + (ALOC_UNIDADE === 'meses' ? 'active' : '') + '" onclick="crAlocSetUnidade(\'meses\')">Mensal</button>' +
      '</div></div>' +
      '<details class="cr-projpick"' + (ALOC_PICK_OPEN ? ' open' : '') + ' ontoggle="crAlocPickToggle(this)">' +
      '<summary><span class="material-symbols-outlined">filter_list</span>Projetos: ' + inc + ' de ' + projs.length + '</summary>' +
      '<div class="cr-projpicklist">' +
      projs.map(function (p, i) {
        return '<label><input type="checkbox" ' + (ALOC_EXCL[p.id] ? '' : 'checked') +
          ' onchange="crAlocToggleProjeto(' + i + ')"><span>' + esc(p.nome) + '</span></label>';
      }).join('') +
      '<div class="cr-hint">Projetos <b>[PROPOSTA]</b> entram desmarcados: são cópias de um projeto ' +
      'existente, e contariam a mesma tarefa duas vezes. Marque a proposta e desmarque o original ' +
      'para comparar os dois cenários.</div>' +
      '</div>' +
      '</details>' +
      '<label class="cr-check"><input type="checkbox" ' + (ALOC_HIDE_DONE ? 'checked' : '') +
      ' onchange="crAlocToggleHideDone()">Ocultar tarefas concluídas</label>' +
      '</div>';
  }
  function crAlocKpis(kpi) {
    return '<div class="cr-kpirow">' +
      '<div class="cr-kpi"><div class="cr-kpik">Colaboradores</div><div class="cr-kpiv">' + kpi.pessoas + '</div></div>' +
      '<div class="cr-kpi"><div class="cr-kpik">Sobrecargas (pessoa × período)</div><div class="cr-kpiv">' + kpi.sobrecarga + '</div></div>' +
      '<div class="cr-kpi"><div class="cr-kpik">Maior pico</div><div class="cr-kpiv">' + (kpi.topPico || '—') + '</div>' +
      (kpi.topNome ? '<div class="cr-projmeta">' + esc(kpi.topNome) + '</div>' : '') + '</div>' +
      '</div>';
  }
  function crAlocLegend() {
    return '<div class="cr-legend">' +
      '<span><b style="color:var(--cr-navy)">nº</b>&nbsp;= projetos simultâneos</span>' +
      '<span><i style="background:var(--cr-amber)"></i>2 — teto praticável</span>' +
      '<span><i style="background:var(--cr-red)"></i>3+ — sobrecarga</span>' +
      /* só duas cores de estado aqui, e é reflexo do modelo: esta visão lê o
         estado DERIVADO (computeProjectView), e a única derivação que sobrou é
         o atraso. Em dia / reprogramada / concluída são declaração período a
         período — moram na linha R do Gantt, não aqui. */
      '<span><i style="background:var(--cr-gray-p)"></i>Planejada</span>' +
      '<span><i style="background:var(--cr-yellow)"></i>Atrasada</span>' +
      '<span><i style="background:var(--cr-navy);width:3px;height:14px;border-radius:0"></i>Hoje (tracejado)</span>' +
      '</div>';
  }
  /* tooltip das células da grade — a cor diz o estado e o número diz a carga,
     mas nenhum dos dois diz QUAL tarefa. Usa o `title` nativo (mesma convenção
     do resto da página) em vez de balão próprio: um elemento posicionado seria
     recortado pelo `overflow` do .cr-ganttwrap, que rola na horizontal.
     O '\n' dentro do atributo quebra linha no balão nativo; esc() não mexe nele. */
  var TIP_MAX = 8;   // teto de linhas por projeto, pra não virar um balão de tela cheia
  function tipTarefas(lista, pad) {
    pad = pad || '';
    var out = (lista || []).slice(0, TIP_MAX).map(function (t) { return pad + '• ' + t; });
    if ((lista || []).length > TIP_MAX) out.push(pad + '… +' + (lista.length - TIP_MAX) + ' tarefa(s)');
    return out.join('\n');
  }
  function alocProjTip(pr, cell, aloc, i) {
    var txt = bucketLabel(aloc.buckets[i], aloc.unidade) + ' · ' + pr.nome + '\n' + tipTarefas(cell.tarefas);
    if (cell.replan) txt += '\n(período que só existe por causa do Novo Prazo)';
    return txt;
  }
  /* na linha da pessoa a célula agrega vários projetos — agrupa as tarefas por
     projeto pra manter as duas leituras separadas também no balão. */
  function alocLoadTip(pe, aloc, i) {
    var txt = bucketLabel(aloc.buckets[i], aloc.unidade) + ' · ' + pe.nome;
    pe.projetos.forEach(function (pr) {
      var cell = pr.cells[i];
      if (cell) txt += '\n' + pr.nome + '\n' + tipTarefas(cell.tarefas, '   ');
    });
    return txt;
  }
  /* célula da linha da pessoa: a carga. Só ganha cor quando há o que olhar —
     2 (âmbar) e 3+ (vermelho). Carga 1 fica sem fundo de propósito, senão o
     verde da linha da pessoa competiria com o verde de "em andamento" das
     sub-linhas de projeto e as duas leituras se confundiriam. */
  function crAlocLoadCells(pe, aloc) {
    var out = '';
    for (var i = 0; i < aloc.n; i++) {
      var c = pe.load[i] || 0;
      var cls = ['cr-loadcell', 'cr-load-' + Math.min(3, c)];
      if (i === aloc.todayIdx) cls.push('cr-todaycol');
      var attrs = c ? ' title="' + esc(alocLoadTip(pe, aloc, i)) + '"' : '';
      out += '<td class="' + cls.join(' ') + '"' + attrs + '>' + (c ? c : '—') + '</td>';
    }
    return out;
  }
  /* célula da sub-linha de projeto: presença binária, colorida com a mesma
     lógica do Gantt. 'futura'/null cai no cinza do "P" — cr-c-futura é
     transparente (no Gantt a linha P cinza é que mostra o plano), e aqui, com
     uma linha só por projeto, transparente deixaria a tarefa invisível. */
  function crAlocProjCells(pr, aloc) {
    var out = '';
    for (var i = 0; i < aloc.n; i++) {
      var cell = pr.cells[i];
      var cls = ['cr-bcell'], attrs = '';
      if (cell) {
        cls.push((!cell.cor || cell.cor === 'futura') ? 'cr-c-p' : 'cr-c-' + cell.cor);
        if (cell.replan) cls.push('cr-c-replan');
        attrs = ' title="' + esc(alocProjTip(pr, cell, aloc, i)) + '"';
      }
      if (i === aloc.todayIdx) cls.push('cr-todaycol');
      out += '<td class="' + cls.join(' ') + '"' + attrs + '></td>';
    }
    return out;
  }
  function crAlocWrap(aloc) {
    var headCols = aloc.buckets.map(function (k, i) {
      return '<th class="cr-bucket' + (i === aloc.todayIdx ? ' cr-todaycol' : '') + '">' + esc(bucketLabel(k, aloc.unidade)) + rszHandle('periodo') + '</th>';
    }).join('');
    var body = '';
    aloc.pessoas.forEach(function (pe, pi) {
      var collapsed = !!ALOC_COLLAPSED[pe.key];
      var caret = collapsed ? 'chevron_right' : 'expand_more';
      var head = '<tr class="cr-pessoa-row" onclick="crAlocTogglePessoa(' + pi + ')">' +
        '<td class="cr-acol-nome"><span class="material-symbols-outlined cr-caret">' + caret + '</span>' + esc(pe.nome) +
        ' <span style="font-weight:600;color:var(--cr-muted)">(' + pe.projetos.length + ')</span></td>' +
        '<td class="cr-acol-pico cr-picocell' + (pe.pico >= 3 ? ' cr-pico-3' : '') + '">' + pe.pico + '</td>' +
        crAlocLoadCells(pe, aloc) + '<td class="cr-spacer"></td></tr>';
      var kids = pe.projetos.map(function (pr, ri) {
        return '<tr class="cr-alocproj-row cr-clickable" title="Abrir o Gantt deste projeto" onclick="crAlocAbrirProjeto(' + pi + ',' + ri + ')">' +
          '<td class="cr-acol-nome cr-alocproj-nome">' + esc(pr.nome) + '</td>' +
          '<td class="cr-acol-pico"></td>' +
          crAlocProjCells(pr, aloc) + '<td class="cr-spacer"></td></tr>';
      }).join('');
      body += '<tbody>' + head + '</tbody>' +
        '<tbody style="' + (collapsed ? 'display:none' : '') + '">' + kids + '</tbody>';
    });
    if (!aloc.pessoas.length) {
      body = '<tbody><tr><td colspan="' + (2 + aloc.n) + '" class="cr-emptyrow">' +
        'Nenhuma tarefa com responsável e data de Fim nos projetos considerados.</td><td class="cr-spacer"></td></tr></tbody>';
    }
    return '<div class="cr-ganttwrap"><table class="cr-gantt">' + colgroupHTML(ALOC_LEAD, aloc.n) + '<thead><tr>' +
      '<th class="cr-acol-nome">Colaborador / Projeto' + rszHandle('anome') + '</th>' +
      '<th class="cr-acol-pico">Pico' + rszHandle('apico') + '</th>' +
      headCols + '<th class="cr-spacer"></th></tr></thead>' + body + '</table></div>';
  }
  function crAlocNote(aloc) {
    var itens = [];
    itens.push('A célula da sub-linha indica <b>presença</b> de tarefa planejada naquele período, ' +
      'não intensidade de esforço. O número na linha da pessoa é a contagem de projetos ' +
      'simultâneos — para uma pessoa só, o teto praticável é <b>2</b>, e mesmo 2 já cobra troca de contexto.');
    itens.push('<b>Passe o mouse</b> sobre uma célula colorida para ver os títulos das tarefas daquele ' +
      'período. Na linha da pessoa, as tarefas vêm agrupadas por projeto.');
    if (aloc.unidade === 'semanas') {
      itens.push('Na visão <b>semanal</b>, um projeto de escopo mensal ocupa <b>todas</b> as semanas que as ' +
        'datas das suas tarefas cobrem (01–30/09 = 5 semanas). É o que as datas dizem, não erro de cálculo.');
    }
    itens.push('A barra vai até <b>max(Fim, Novo Prazo)</b> — é onde o trabalho vai consumir tempo. ' +
      'O tom escuro marca o período que só existe por causa do Novo Prazo.');
    itens.push('Esta visão é de <b>planejamento</b>: a célula é cinza porque há trabalho previsto ali. ' +
      'Ela não repete o que foi declarado célula por célula na linha R do Gantt — lá se registra o que ' +
      'aconteceu em cada período, aqui se olha onde o trabalho está previsto. A única cor de estado é ' +
      'o <b>amarelo de atrasada</b>, que vem das datas (Data de Revisão além do prazo). O que também ' +
      'atravessa é o status da tarefa: marcar o último período como concluída tira a tarefa daqui ' +
      'quando "esconder concluídas" está ligado.');
    if (aloc.semFim.length) {
      var porProj = Object.create(null);   // chave = nome de projeto (texto livre), ver byKey
      aloc.semFim.forEach(function (s) { porProj[s.projeto] = (porProj[s.projeto] || 0) + 1; });
      var lista = Object.keys(porProj).map(function (nome) { return esc(nome) + ' (' + porProj[nome] + ')'; }).join(' · ');
      itens.push('<b>' + aloc.semFim.length + ' tarefa(s) sem data de Fim</b> ficaram fora da conta: ' + lista + '.');
    }
    var fora = (DATA.projetos || []).filter(function (p) { return ALOC_EXCL[p.id]; });
    if (fora.length) {
      itens.push('Fora da conta agora: ' + fora.map(function (p) { return esc(p.nome); }).join(' · ') + '.');
    }
    return '<div class="cr-alocnote"><b>Como ler:</b><ul><li>' + itens.join('</li><li>') + '</li></ul></div>';
  }
  function renderOcupacao(root) {
    seedAlocDefaults();
    var projs = alocProjetosConsiderados();
    var aloc = buildAllocation(projs, ALOC_UNIDADE, { hideDone: ALOC_HIDE_DONE });
    LAST_ALOC = aloc;
    var kpi = allocKPIs(aloc);
    root.innerHTML =
      '<div class="cr-stickytop">' +
      '<div class="cr-projhead"><div><h2>Ocupação da equipe</h2>' +
      '<div class="cr-projmeta">Projetos simultâneos por colaborador — consolidado de todos os projetos considerados</div>' +
      '</div></div>' +
      crAlocTools() + crAlocKpis(kpi) + crAlocLegend() +
      '</div>' +
      crAlocWrap(aloc) + crAlocNote(aloc);
  }

  function renderProjSelector() {
    var sel = document.getElementById('cr-projsel'); if (!sel) return;
    sel.innerHTML = DATA.projetos.map(function (p) { return '<option value="' + p.id + '"' + (p.id === CUR_PROJ_ID ? ' selected' : '') + '>' + esc(p.nome) + '</option>'; }).join('');
    sel.style.display = DATA.projetos.length ? '' : 'none';
  }
  function renderToolbarButtons() {
    var ocupacao = VIEW_MODE === 'ocupacao';
    // o seletor de projeto e o "+ Projeto" são por projeto — não fazem sentido
    // na visão consolidada de ocupação.
    var sel = document.getElementById('cr-projsel');
    if (sel) sel.style.display = (!ocupacao && DATA && DATA.projetos.length) ? '' : 'none';
    var btnNovo = document.getElementById('cr-btnnovo');
    if (btnNovo) btnNovo.style.display = (!ocupacao && isEditable()) ? '' : 'none';
    // O modo apresentação é apenas uma preferência de visualização.
    var btnPresent = document.getElementById('cr-btnpresent');
    if (btnPresent) {
      btnPresent.style.display = (!ocupacao) ? '' : 'none';
      btnPresent.innerHTML = PRESENT_MODE ?
        '<span class="material-symbols-outlined">edit</span>Modo edição' :
        '<span class="material-symbols-outlined">visibility</span>Modo apresentação';
    }
    // A visão de ocupação é uma visão de leitura consolidada.
    var btnView = document.getElementById('cr-btnview');
    if (btnView) {
      btnView.style.display = (DATA && DATA.projetos.length) ? '' : 'none';
      btnView.innerHTML = ocupacao ?
        '<span class="material-symbols-outlined">view_timeline</span>Gantt do projeto' :
        '<span class="material-symbols-outlined">groups</span>Ocupação da equipe';
    }
    // tela cheia: só faz sentido com tabela na tela, mas vale nas duas visões e
    //  — é leitura, não edição.
    var btnFull = document.getElementById('cr-btnfull');
    if (btnFull) {
      btnFull.style.display = (DATA && DATA.projetos.length) ? '' : 'none';
      btnFull.innerHTML = isFull() ?
        '<span class="material-symbols-outlined">fullscreen_exit</span>Sair da tela cheia' :
        '<span class="material-symbols-outlined">fullscreen</span>Tela cheia';
    }
    // largura de coluna é a outra preferência de leitura: mesma condição do
    // tela cheia (precisa de tabela na tela) e mesma indiferença a quem edita.
    // O COLW é único pra página, então um botão só zera as colunas das duas
    // visões — a Ocupação tem colunas próprias (anome/apico) e cai no mesmo
    // reset. Ver crResetColWidths().
    var btnResetW = document.getElementById('cr-btnresetcolw');
    if (btnResetW) btnResetW.style.display = (DATA && DATA.projetos.length) ? '' : 'none';
  }

  /* ---------- ROLAGEM ENTRE RENDERS ----------
     O render() remonta o innerHTML inteiro, então o painel da tabela é
     destruído e recriado — e a posição de rolagem vai com ele. Era isso que
     jogava a tabela de volta pro começo ao marcar um período: nada a ver com o
     save, que só acontecia junto.

     Só restaura quando a tela é a MESMA (mesma visão, mesmo projeto). Trocar de
     projeto ou de visão deve começar do início, senão a rolagem herdada mostra
     o meio de um cronograma que a pessoa nunca viu. */
  var LAST_RENDER_KEY = null;
  function scrollSnapshot() {
    var w = document.querySelector('.cr-ganttwrap');
    return { x: w ? w.scrollLeft : 0, y: w ? w.scrollTop : 0, page: window.scrollY || 0 };
  }
  function scrollRestore(s) {
    var w = document.querySelector('.cr-ganttwrap');
    if (w) {
      /* leitura só pra forçar o reflow: relayout() acabou de ESCREVER as
         larguras das <col> e o --cr-tw. Sem o layout recalculado, o navegador
         ainda acha a tabela mais estreita e corta o scrollLeft no máximo
         antigo — a rolagem horizontal voltaria "quase" pro lugar. */
      void w.scrollWidth;
      w.scrollLeft = s.x; w.scrollTop = s.y;
    }
    if (s.page) window.scrollTo(0, s.page);
  }

  function render() {
    ensureCurrentProject();
    renderProjSelector();
    renderToolbarButtons();
    var root = document.getElementById('cr-body');
    var chave = VIEW_MODE + '|' + (VIEW_MODE === 'ocupacao' ? '' : CUR_PROJ_ID);
    var scroll = (chave === LAST_RENDER_KEY) ? scrollSnapshot() : null;
    LAST_RENDER_KEY = chave;
    if (!DATA.projetos.length) { root.innerHTML = crEmptyState(); return; }
    if (VIEW_MODE === 'ocupacao') {
      renderOcupacao(root);
      relayout();            // depois do innerHTML: é ele que cria as <col>
      if (scroll) scrollRestore(scroll);
      return;
    }
    var p = findProjeto(CUR_PROJ_ID);
    var pv = computeProjectView(p);
    var kpi = projectKPIs(p, pv);
    root.innerHTML = '<div class="cr-stickytop">' + crProjectHeader(p) + crKpiRow(p, pv, kpi) +
      crFcaAlert(p) + crActionsBar(p) + crLegend() + crFcaPanel(p, pv) + '</div>' + crGanttWrap(p, pv);
    relayout();
    if (scroll) scrollRestore(scroll);
  }

  /* quanto sobra de tela abaixo do bloco fixo (título+KPIs+ações+legenda)
     muda conforme o conteúdo (alerta de Data de Revisão ausente, ações só
     pra quem edita, legenda quebrando linha em telas estreitas) e o
     tamanho da janela — por isso é recalculado a cada render() e no
     resize, em vez de um valor fixo no CSS. */
  function syncTableMaxHeight() {
    var stickyTop = document.querySelector('.cr-stickytop');
    var wrap = document.querySelector('.cr-ganttwrap');
    var root = document.getElementById('cr-root');
    if (!stickyTop || !wrap || !root) return;
    var spaceBelow = window.innerHeight - stickyTop.getBoundingClientRect().bottom - 24;
    root.style.setProperty('--cr-tablemaxh', Math.max(200, spaceBelow) + 'px');
  }
  var stickyResizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(stickyResizeTimer);
    // relayout, não só syncTableMaxHeight: a largura do painel mudou, logo a
    // sobra a distribuir entre as colunas mudou também
    stickyResizeTimer = setTimeout(relayout, 120);
  });

  /* ---------- TELA CHEIA ----------
     Fullscreen nativo no **#cr-root**, e não na `.cr-ganttwrap`. Isso é
     load-bearing: em fullscreen o navegador renderiza SÓ a subárvore do
     elemento escolhido. Pegando a tabela, o modal (#cr-modalbg), o toast e o
     dropdown de marcar período — que são irmãos dela dentro do #cr-root —
     ficariam invisíveis, e clicar numa célula viraria um clique sem resposta.
     Pegando o root, os três continuam funcionando, e o header da página e a
     sidebar somem de graça porque estão fora dele.

     Fallback em overlay pra quando o navegador recusa o pedido (política de
     permissão, iframe sem `allow="fullscreen"`): a promessa rejeita e a classe
     é aplicada do mesmo jeito, com `position:fixed`. Perde-se esconder a barra
     do navegador; a tabela ganha a área da mesma forma.

     NÃO persiste no localStorage, diferente das outras preferências de leitura:
     fullscreen nativo só pode ser pedido dentro de um gesto do usuário, então
     restaurar no load falharia e o estado guardado passaria a mentir. */
  var FULL_FALLBACK = false;      // true = overlay CSS, sem fullscreen nativo
  function crRoot() { return document.getElementById('cr-root'); }
  function isFull() {
    return FULL_FALLBACK || (!!document.fullscreenElement && document.fullscreenElement === crRoot());
  }
  function aplicarFull() {
    var root = crRoot();
    var on = isFull();
    if (root) {
      root.classList.toggle('cr-full', on);
      root.classList.toggle('cr-full-overlay', on && FULL_FALLBACK);
    }
    document.body.classList.toggle('cr-fullbody', on);
    renderToolbarButtons();
    /* relayout agora E no frame seguinte: o fullscreenchange pode chegar antes
       de o navegador atualizar window.innerHeight, e é dele que sai a altura
       máxima da tabela (syncTableMaxHeight). Sem a segunda passada a tabela fica
       com a altura da janela antiga até o resize debounced chegar. */
    relayout();
    if (window.requestAnimationFrame) requestAnimationFrame(relayout);
  }
  window.crToggleFullscreen = function () {
    var root = crRoot();
    if (!root) return;
    if (isFull()) {
      if (FULL_FALLBACK) { FULL_FALLBACK = false; aplicarFull(); }
      else if (document.exitFullscreen) document.exitFullscreen();   // dispara fullscreenchange
      return;
    }
    if (root.requestFullscreen) {
      var p = root.requestFullscreen();
      // Safari antigo devolve undefined em vez de Promise
      if (p && p.catch) p.catch(function () { FULL_FALLBACK = true; aplicarFull(); });
    } else {
      FULL_FALLBACK = true; aplicarFull();
    }
  };
  /* Cobre entrar E sair, inclusive a saída por Esc / F11 — que acontecem sem
     passar pelo nosso botão. */
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement) FULL_FALLBACK = false;
    aplicarFull();
  });
  /* Esc no modo fallback: o navegador não tem fullscreen pra fechar, então o
     atalho é nosso. Só age quando o overlay está ativo e o modal está fechado —
     com o modal aberto, Esc pertence a ele (o clique no fundo já fecha). */
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || !FULL_FALLBACK) return;
    var bg = document.getElementById('cr-modalbg');
    if (bg && bg.classList.contains('show')) return;
    FULL_FALLBACK = false; aplicarFull();
  });

  /* ---------- MODO APRESENTAÇÃO ---------- */
  window.crTogglePresentMode = function () {
    PRESENT_MODE = !PRESENT_MODE;
    try { localStorage.setItem(PRESENT_KEY, PRESENT_MODE ? '1' : '0'); } catch (e) { }
    render();
  };

  /* ---------- VISÃO DE OCUPAÇÃO (handlers) ---------- */
  window.crToggleViewMode = function () {
    VIEW_MODE = (VIEW_MODE === 'ocupacao') ? 'gantt' : 'ocupacao';
    lsSet(VIEW_KEY, VIEW_MODE);
    render();
  };
  window.crAlocSetUnidade = function (u) {
    ALOC_UNIDADE = (u === 'meses') ? 'meses' : 'semanas';
    lsSet(ALOC_UNIDADE_KEY, ALOC_UNIDADE);
    render();
  };
  /* o <details> do seletor é recriado a cada render, então o estado de
     aberto/fechado tem que viver fora do DOM — senão marcar um projeto fecha o
     painel e obriga a reabrir pra marcar o próximo. Não persiste: é momentâneo. */
  window.crAlocPickToggle = function (el) { ALOC_PICK_OPEN = !!(el && el.open); };
  /* relayout() no toggle porque o painel vive no bloco fixo: abrir/fechar muda a
     altura dele, e é do rodapé desse bloco que sai a altura máxima da tabela
     (syncTableMaxHeight). Sem isto a tabela só se ajustaria no próximo render ou
     resize — abrir o painel deixaria a tabela invadindo o rodapé da tela. */
  window.crFcaPanelToggle = function (el) {
    FCA_PANEL_OPEN = !!(el && el.open);
    lsSet(FCA_PANEL_KEY, FCA_PANEL_OPEN ? '1' : '0');
    relayout();
  };
  window.crAlocToggleProjeto = function (i) {
    var p = (DATA.projetos || [])[i]; if (!p) return;
    if (ALOC_EXCL[p.id]) delete ALOC_EXCL[p.id]; else ALOC_EXCL[p.id] = true;
    ALOC_DECIDED[p.id] = true;   // a partir daqui a escolha dele vence o default
    lsSet(ALOC_EXCL_KEY, ALOC_EXCL);
    lsSet(ALOC_DECIDED_KEY, ALOC_DECIDED);
    render();
  };
  window.crAlocToggleHideDone = function () {
    ALOC_HIDE_DONE = !ALOC_HIDE_DONE;
    lsSet(ALOC_HIDE_DONE_KEY, ALOC_HIDE_DONE ? '1' : '0');
    render();
  };
  window.crAlocTogglePessoa = function (pi) {
    var pe = LAST_ALOC && LAST_ALOC.pessoas[pi]; if (!pe) return;
    if (ALOC_COLLAPSED[pe.key]) delete ALOC_COLLAPSED[pe.key]; else ALOC_COLLAPSED[pe.key] = true;
    lsSet(ALOC_COLLAPSED_KEY, ALOC_COLLAPSED);
    render();
  };
  /* atalho de navegação: da carga da pessoa direto pro Gantt do projeto que
     está causando a sobreposição, que é onde a etapa se redimensiona. */
  window.crAlocAbrirProjeto = function (pi, ri) {
    var pe = LAST_ALOC && LAST_ALOC.pessoas[pi]; if (!pe) return;
    var pr = pe.projetos[ri]; if (!pr) return;
    CUR_PROJ_ID = pr.id;
    VIEW_MODE = 'gantt';
    lsSet(VIEW_KEY, VIEW_MODE);
    render();
  };

  /* ---------- INIT ---------- */
  /* preferências de LEITURA (não de dados): qual visão, granularidade, quais
     projetos entram na conta, o que está colapsado. Vivem só no localStorage —
     são escolhas de cada um, não fazem parte do cronograma. */
  function loadPrefs() {
    try {
      PRESENT_MODE = localStorage.getItem(PRESENT_KEY) === '1';
      VIEW_MODE = localStorage.getItem(VIEW_KEY) === 'ocupacao' ? 'ocupacao' : 'gantt';
      ALOC_UNIDADE = localStorage.getItem(ALOC_UNIDADE_KEY) === 'meses' ? 'meses' : 'semanas';
      ALOC_HIDE_DONE = localStorage.getItem(ALOC_HIDE_DONE_KEY) === '1';
      FCA_PANEL_OPEN = localStorage.getItem(FCA_PANEL_KEY) === '1';
    } catch (e) { }
    ALOC_EXCL = lsGetJSON(ALOC_EXCL_KEY, {});
    ALOC_DECIDED = lsGetJSON(ALOC_DECIDED_KEY, {});
    ALOC_COLLAPSED = lsGetJSON(ALOC_COLLAPSED_KEY, {});
    COLW = lsGetJSON(COLW_KEY, {});
  }

  function init(recarga) {
    if (!recarga) loadPrefs();
    return loadData().then(function () {
      render();
    });
  }
  /* ---------- HOOK DE TESTE ----------
     Handle de leitura pras funções PURAS de domínio, pro harness em
     `tests/js/cronograma.test.js` exercitá-las sem navegador (ver
     `tests/js/README.md`). Todas são funções que só LEEM o projeto que recebem:
     nenhuma escreve em DATA ou no localStorage, então expor não
     abre caminho de escrita nenhum.

     Existe porque a regra de atraso mora aqui, no front, e é justamente a que
     errava calado até ago/2026: tarefa com prazo vencido contava como em dia se
     alguém tivesse marcado "Em dia" num período anterior. Erro de leitura de
     cronograma não estoura exceção; só produz um
     número errado na tela, que alguém acredita. Teste é a única rede aqui. */
  window.__crTest = {
    computeProjectView: computeProjectView,
    realizadoAt: realizadoAt,
    atrasadaKPI: atrasadaKPI,
    projectKPIs: projectKPIs,
    etapaCells: etapaCells,
    normalizeProjeto: normalizeProjeto,
    ultimaMarca: ultimaMarca,
    bucketKey: bucketKey,
    bucketLabel: bucketLabel,
    periodoISO: periodoISO,
    periodoLabel: periodoLabel,
    fcaPendencias: fcaPendencias,
    fcaRegistros: fcaRegistros,
  };

  init();
})();
