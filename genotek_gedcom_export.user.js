// ==UserScript==
// @name         Genotek family tree downloader
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Add a button to the page that runs a function
// @match        https://lk.genotek.ru/*
// @grant        none
// ==/UserScript==


(function () {
    'use strict';

    // Part 1. Injection ne item into the menu

    function injectGedcomMenuItem() {
        if (document.getElementById('gedcom-menu-item')) return;

        const items = document.querySelectorAll('.tree__actions-btn-menu-item');
        for (const item of items) {
            if (item.textContent.includes('Загрузить GEDCOM')) {
                const newItem = item.cloneNode(true);
                newItem.id = 'gedcom-menu-item';
                newItem.querySelector('i').className = 'icon-download';
                newItem.childNodes[1].textContent = 'Сохранить GEDCOM';

                newItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const tree = window.__myGenealogyTree;
                    if (!tree) {
                        alert('Генеалогическое дерево еще не загружено.');
                        return;
                    }
                    const gedcomText = exportGenotekToGedcom(tree);
                    saveGedcom(gedcomText, 'tree.ged');
                });

                item.parentNode.insertBefore(newItem, item.nextSibling);
                return;
            }
        }
    }





    function injectRelativesPageGedcomButton() {
        const style = document.createElement('style');
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

        const interval = setInterval(() => {
            const container = document.querySelector('.tree__actions');
            if (!container || container.querySelector('#gedcom-relatives-btn')) return;

            clearInterval(interval);

            const btn = document.createElement('div');
            btn.id = 'gedcom-relatives-btn';
            btn.title = 'Сохранить GEDCOM';
            btn.className = 'tree__gedcom-download-btn';

            const icon = document.createElement('i');
            icon.className = 'icon-download';
            btn.appendChild(icon);

            // ✨ Add click handler
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tree = window.__myGenealogyTree;
                if (!tree) {
                    alert('Генеалогическое дерево еще не загружено.');
                    return;
                }
                const gedcomText = exportGenotekToGedcom(tree);
                saveGedcom(gedcomText, 'tree.ged');
            });

            // Insert the button BELOW the zoom buttons
            const zoomContainer = container.querySelector('.tree__zoom');
            if (zoomContainer) {
                zoomContainer.after(btn);
            } else {
                container.appendChild(btn);
            }

        }, 300);
    }





    function pollForMenuAndInject(maxTries = 20, delay = 100) {
        let tries = 0;
        const interval = setInterval(() => {
            const items = document.querySelectorAll('.tree__actions-btn-menu-item');
            for (const item of items) {
                if (
                    item.textContent.includes('Загрузить GEDCOM') &&
                    !document.getElementById('gedcom-menu-item')
                ) {
                    console.log('[GEDCOM] Injecting menu item');
                    injectGedcomMenuItem();
                    clearInterval(interval);
                    return;
                }
            }
            if (++tries >= maxTries) {
                console.log('[GEDCOM] Menu not found, giving up');
                clearInterval(interval);
            }
        }, delay);
    }


    function setupInjectionOnMenuOpen() {
        document.body.addEventListener('click', (e) => {
            const btn = e.target.closest('.tree__actions-btn');
            if (btn) {
                setTimeout(() => {
                    pollForMenuAndInject(); // ← use polling instead of MutationObserver
                }, 50);
            }
        });
    }

    // === SPA NAVIGATION DETECTOR ===
    function checkIfTreePage() {
        if (location.pathname.includes('/genealogical-tree')) {
            setupInjectionOnMenuOpen();
        } else if (location.pathname.includes('/ancestry/relatives')) {
            const btn = document.getElementById('gedcom-relatives-btn');
            if (btn) btn.remove();
            const interval = setInterval(() => {
                const button = document.querySelector('button.find-relation-graph__modal-place');
                if (button) {
                    clearInterval(interval);
                    injectRelativesPageGedcomButton();
                }
            }, 300);
        }
    }

    function hookSPAChanges() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function (...args) {
            originalPushState.apply(this, args);
            setTimeout(checkIfTreePage, 100);
        };

        history.replaceState = function (...args) {
            originalReplaceState.apply(this, args);
            setTimeout(checkIfTreePage, 100);
        };

        window.addEventListener('popstate', checkIfTreePage);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        hookSPAChanges();
        checkIfTreePage(); // run immediately in case already on tree page
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            hookSPAChanges();
            checkIfTreePage();
        });
    }



    // Part 2. GEDCOM generation


    const originalXHR = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this.__url = url;
        return originalXHR.apply(this, arguments);
    };

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            // api/v1/site/1/relatives/VJ8248/8ec016a33c403d578e1517d152c6ef9f/genealogy-graph
            if (this.__url && this.__url.includes('/genealogy-graph')) {
                try {
                    const data = JSON.parse(this.responseText);
                    window.__myGenealogyTree = data;
                } catch (e) {
                    console.warn("Failed to parse XHR response JSON:", e);
                }
            }
        });

        return originalSend.apply(this, arguments);
    };

    function saveGedcom(gedcomText, filename = 'tree.ged') {
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
        let personCounter = 1;
        let familyCounter = 1;

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
            if (obj.month) parts.push(monthNames[obj.month]);
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
                const gedcomId = `@I${personCounter++}@`;
                peopleMap[id] = { gedcomId, data: node, fams: new Set(), famc: new Set() };
            }
        }

        // STEP 2: Register families
        for (const node of nodes) {
            if (node.type === 'FAMILY') {
                const parts = node.id.split('_');
                const fatherId = parts[1] !== 'none' ? parts[1] : null;
                const motherId = parts[2] !== 'none' ? parts[2] : null;

                const husbandGedcom = (fatherId && peopleMap[fatherId]) ? peopleMap[fatherId].gedcomId : null;
                const wifeGedcom = (motherId && peopleMap[motherId]) ? peopleMap[motherId].gedcomId : null;

                if (!husbandGedcom && !wifeGedcom) continue;

                const famId = `@F${familyCounter++}@`;

                if (fatherId && peopleMap[fatherId]) peopleMap[fatherId].fams.add(famId);
                if (motherId && peopleMap[motherId]) peopleMap[motherId].fams.add(famId);

                families.push({
                    gedcomId: famId,
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
