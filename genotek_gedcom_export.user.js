// ==UserScript==
// @name         Genotek family tree downloader
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Export the Genotek relatives tree as GEDCOM
// @match        https://lk.genotek.ru/*
// @grant        none
// @run-at       document-start
// ==/UserScript==


(function () {
    'use strict';

    const GRAPH_URL_PART = '/genealogy-graph';
    let genealogyTree = null;

    function rememberTree(data) {
        if (!data || !Array.isArray(data.data?.nodes)) return;
        genealogyTree = data;
        // Kept for backwards compatibility and easy inspection in DevTools.
        window.__myGenealogyTree = data;
        updateButtonState();
        console.info(`[GEDCOM] Captured ${data.data.nodes.length} tree nodes`);
    }

    function parseTreeResponse(payload) {
        try {
            rememberTree(typeof payload === 'string' ? JSON.parse(payload) : payload);
        } catch (error) {
            console.warn('[GEDCOM] Could not parse genealogy graph response', error);
        }
    }

    // Install the network hooks immediately. Angular can request the graph before
    // DOMContentLoaded, so doing this after UI setup loses the response.
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        this.__gedcomUrl = String(url);
        return originalXhrOpen.apply(this, arguments);
    };

    const originalXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
        if (this.__gedcomUrl?.includes(GRAPH_URL_PART)) {
            this.addEventListener('load', () => parseTreeResponse(
                this.responseType === '' || this.responseType === 'text'
                    ? this.responseText
                    : this.response
            ));
        }
        return originalXhrSend.apply(this, arguments);
    };

    const originalFetch = window.fetch;
    if (originalFetch) {
        window.fetch = async function (input, init) {
            const response = await originalFetch.apply(this, arguments);
            const url = typeof input === 'string' ? input : input?.url;
            if (url?.includes(GRAPH_URL_PART)) {
                response.clone().json().then(rememberTree).catch(error => {
                    console.warn('[GEDCOM] Could not parse genealogy graph fetch', error);
                });
            }
            return response;
        };
    }


    function injectRelativesPageGedcomButton() {
        if (document.getElementById('gedcom-download-style')) return;
        const style = document.createElement('style');
        style.id = 'gedcom-download-style';
        style.innerHTML = `
    .tree__gedcom-download-btn {
      background: white !important;
      border-radius: 12px !important;
      padding: 10px !important;
      margin-top: 10px !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 36px !important;
      height: 36px !important;
      z-index: 9999 !important;
      pointer-events: auto !important;
    }

    .tree__gedcom-download-btn i {
      font-size: 18px !important;
      pointer-events: none !important;
    }
  `;
        document.head.appendChild(style);
    }

    function updateButtonState() {
        const btn = document.getElementById('gedcom-relatives-btn');
        if (!btn) return;
        btn.title = genealogyTree
            ? `Сохранить GEDCOM (${genealogyTree.data.nodes.length} записей)`
            : 'Ожидание загрузки дерева…';
        btn.style.opacity = genealogyTree ? '1' : '0.55';
    }

    function ensureGedcomButton() {
        if (!location.pathname.includes('/ancestry/relatives')) return;
        injectRelativesPageGedcomButton();
        const container = document.querySelector('.tree__actions');
        if (!container || container.querySelector('#gedcom-relatives-btn')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'gedcom-relatives-btn';
        btn.className = 'tree__gedcom-download-btn';

        const icon = document.createElement('i');
        icon.className = 'icon-download';
        btn.appendChild(icon);

        btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tree = genealogyTree || window.__myGenealogyTree;
                if (!tree) {
                    alert('Данные дерева еще не получены. Обновите страницу при включенном userscript.');
                    return;
                }
                const gedcomText = exportGenotekToGedcom(tree);
                let filename = 'relative_genotek_family_tree.ged';

                if (tree.data.patientId) {
                    const matchingNode = tree.data.nodes?.find(
                        node => node.card?.patientId === tree.data.patientId
                    );

                    if (matchingNode?.card) {
                        const card = matchingNode.card || {};
                        const name = (card.name || []).join('_');
                        const middleName = (card.middleName || []).join('_');
                        const surname = (card.surname || []).join('_');
                        const fullName = [name, middleName, surname]
                        .filter(Boolean)
                        .join('_')
                        .replace(/\s+/g, '_')
                        .replace(/[^\p{L}\p{N}_-]/gu, ''); // remove problematic characters
                        if (fullName) filename = `${fullName}.ged`;
                    }
                }
                saveGedcom(gedcomText, filename);
        });

        // Insert the button below the zoom controls.
        const zoomContainer = container.querySelector('.tree__zoom');
        if (zoomContainer) {
            zoomContainer.after(btn);
        } else {
            container.appendChild(btn);
        }
        updateButtonState();
    }

    function startUiObserver() {
        ensureGedcomButton();
        new MutationObserver(ensureGedcomButton).observe(document.body, {
            childList: true,
            subtree: true
        });
        window.addEventListener('popstate', () => setTimeout(ensureGedcomButton));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startUiObserver, { once: true });
    } else {
        startUiObserver();
    }



    // Part 2. GEDCOM generation


    function saveGedcom(gedcomText, filename = 'my_genotek_family_tree.ged') {
        const blob = new Blob([gedcomText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function exportGenotekToGedcom(treeJson) {
        const nodes = treeJson.data?.nodes || [];
        const peopleMap = {};
        const families = [];
        const familyMap = {};
        const relationshipMap = {};
        const individualBlocks = [];
        const familyBlocks = [];

        function formatGedcomDate(obj) {
            if (!obj?.year) return '';
            const monthNames = [
                '', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
            ];
            const parts = [];
            if (obj.day) parts.push(obj.day);
            if (obj.month && monthNames[obj.month]) parts.push(monthNames[obj.month]);
            parts.push(obj.year);
            return parts.join(' ');
        }

        // STEP 0: Extract relationships
        for (const node of nodes) {
            if (node.card?.relationships?.length) {
                const selfId = node.id;
                for (const rel of node.card.relationships) {
                    const otherId = rel.with;
                    if (!otherId || !rel.type) continue;
                    const key = [selfId, otherId].sort().join('_');
                    relationshipMap[key] = {
                        from: rel.from?.[0],
                        to: rel.to?.[0],
                        type: rel.type,
                        finished: rel.finished
                    };
                }
            }
        }

        // STEP 1: Register people
        for (const node of nodes) {
            if (node.type === 'MALE' || node.type === 'FEMALE') {
                const id = node.id;
                const gedcomId = `@I${id}@`;
                peopleMap[id] = { gedcomId, data: node, fams: new Set(), famc: new Set() };
            }
        }

        // STEP 2: Register families
        for (const node of nodes) {
            if (node.type === 'FAMILY') {
                const parts = node.id.split('_');
                const fatherId = parts[1] !== 'none' ? parts[1] : null;
                const motherId = parts[2] !== 'none' ? parts[2] : null;
                const uid = node.id

                const husbandGedcom = (fatherId && peopleMap[fatherId]) ? peopleMap[fatherId].gedcomId : null;
                const wifeGedcom = (motherId && peopleMap[motherId]) ? peopleMap[motherId].gedcomId : null;

                if (!husbandGedcom && !wifeGedcom) continue;

                const famId = `@F${uid}@`;

                if (fatherId && peopleMap[fatherId]) peopleMap[fatherId].fams.add(famId);
                if (motherId && peopleMap[motherId]) peopleMap[motherId].fams.add(famId);

                families.push({
                    gedcomId: famId,
                    uid: uid,
                    husbandId: husbandGedcom,
                    wifeId: wifeGedcom,
                    children: [],
                    fatherId,
                    motherId
                });

                const key1 = `${fatherId || 'none'}_${motherId || 'none'}`;
                const key2 = `${motherId || 'none'}_${fatherId || 'none'}`;
                familyMap[key1] = famId;
                familyMap[key2] = famId;
            }
        }

        // STEP 3: Assign children
        for (const personId in peopleMap) {
            const person = peopleMap[personId];
            const relatives = person.data.card?.relatives || [];

            const parentIds = relatives
            .filter(r => r.relationType === 'parent')
            .map(r => r.id)
            .filter(pid => pid && peopleMap[pid]);

            const father = parentIds.find(pid => peopleMap[pid].data.card?.gender === 'Male');
            const mother = parentIds.find(pid => peopleMap[pid].data.card?.gender === 'Female');

            if (father || mother) {
                const famKey = `${father || 'none'}_${mother || 'none'}`;
                const famId = familyMap[famKey];
                if (famId) {
                    person.famc.add(famId);
                    const fam = families.find(f => f.gedcomId === famId);
                    if (fam && !fam.children.includes(person.gedcomId)) {
                        fam.children.push(person.gedcomId);
                    }
                }
            }
        }

        // STEP 4: Generate individuals
        for (const personId in peopleMap) {
            const { gedcomId, data, fams, famc } = peopleMap[personId];

            const card = data.card || {};
            const given = (card.name || []).join(' ');
            const middle = (card.middleName || []).join(' ');
            const surname = (card.surname || []).join(' ');
            const maiden = (card.maidenName || []).join(' ');

            const givenFull = [given, middle].filter(Boolean).join(' ');
            const primarySurname = surname || maiden || '';

            const lines = [`0 ${gedcomId} INDI`];

            if (givenFull || primarySurname) {
                lines.push(`1 NAME ${givenFull} /${primarySurname}/`);
                if (givenFull) lines.push(`2 GIVN ${givenFull}`);
                if (surname) lines.push(`2 SURN ${surname}`);
                if (maiden && maiden !== surname) {
                    lines.push(`1 NAME ${givenFull} /${maiden}/`);
                    lines.push(`2 TYPE maiden`);
                }
            }

            const sex = card.gender === 'Male' ? 'M' : (card.gender === 'Female' ? 'F' : '');
            if (sex) lines.push(`1 SEX ${sex}`);

            const birth = card.birthdate?.[0];
            const birthPlace = card.birthplace?.[0] || '';
            if (birth || birthPlace) {
                lines.push(`1 BIRT`);
                const dateStr = formatGedcomDate(birth);
                if (dateStr) lines.push(`2 DATE ${dateStr}`);
                if (birthPlace) lines.push(`2 PLAC ${birthPlace}`);
            }

            const death = card.deathdate?.[0];
            const deathPlace = card.deathplace?.[0] || '';
            if (death || deathPlace) {
                lines.push(`1 DEAT`);
                const dateStr = formatGedcomDate(death);
                if (dateStr) lines.push(`2 DATE ${dateStr}`);
                if (deathPlace) lines.push(`2 PLAC ${deathPlace}`);
            }

            for (const fid of fams) {
                lines.push(`1 FAMS ${fid}`);
            }
            for (const fid of famc) {
                lines.push(`1 FAMC ${fid}`);
            }

            lines.push(`1 _UID ${card.id || personId}`);
            lines.push(`1 REFN ${card.id || personId}`);
            lines.push('2 TYPE GenotekID');

            individualBlocks.push(lines.join('\n'));
        }

        // STEP 5: Generate family blocks
        for (const fam of families) {
            const lines = [`0 ${fam.gedcomId} FAM`];
            if (fam.husbandId) lines.push(`1 HUSB ${fam.husbandId}`);
            if (fam.wifeId) lines.push(`1 WIFE ${fam.wifeId}`);
            for (const child of fam.children) {
                lines.push(`1 CHIL ${child}`);
            }

            const relKey = [fam.fatherId, fam.motherId].sort().join('_');
            const rel = relationshipMap[relKey];
            if (rel && rel.type === 'official') {
                if (rel.from) {
                    const date = formatGedcomDate(rel.from);
                    lines.push(`1 MARR`);
                    if (date) lines.push(`2 DATE ${date}`);
                }
                if (rel.to) {
                    const date = formatGedcomDate(rel.to);
                    lines.push(`1 DIV`);
                    if (date) lines.push(`2 DATE ${date}`);
                }
            }

            lines.push(`1 _UID ${fam.uid}`);
            lines.push(`1 REFN ${fam.uid}`);
            lines.push('2 TYPE GenotekFamilyID');

            familyBlocks.push(lines.join('\n'));
        }

        // STEP 6: Combine and return GEDCOM
        return [
            '0 HEAD',
            '1 SOUR GenotekConverter',
            '1 GEDC',
            '2 VERS 5.5.1',
            '1 CHAR UTF-8',
            ...individualBlocks,
            ...familyBlocks,
            '0 TRLR'
        ].join('\n') + '\n';
    }


})();
