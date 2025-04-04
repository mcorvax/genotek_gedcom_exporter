// ==UserScript==
// @name         Genotek family tree downloader
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Add a button to the page that runs a function
// @match        https://lk.genotek.ru/genealogical-tree
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function waitForMenuItem(text, callback) {
        const interval = setInterval(() => {
            const items = document.querySelectorAll('.tree__actions-btn-menu-item');
            for (let item of items) {
                if (item.textContent.includes(text)) {
                    clearInterval(interval);
                    callback(item);
                    return;
                }
            }
        }, 500);
    }

    waitForMenuItem("Загрузить GEDCOM", (targetEl) => {
        // Clone the existing GEDCOM upload item for consistent styling
        const newItem = targetEl.cloneNode(true);
        newItem.querySelector('i').className = 'icon-download'; // change icon
        newItem.childNodes[1].textContent = 'Сохранить GEDCOM'; // change label

        // Add your custom action
        newItem.addEventListener('click', (e) => {
            e.stopPropagation();
            // Make sure this is called after `window.__myGenealogyTree` is filled
            const gedcomText = exportGenotekToGedcom(window.__myGenealogyTree);
            saveGedcom(gedcomText);
        });

        // Insert after the matched element
        targetEl.parentNode.insertBefore(newItem, targetEl.nextSibling);
    });


    const originalXHR = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this.__url = url;
        return originalXHR.apply(this, arguments);
    };

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            if (this.__url && this.__url.includes('/api/v1/genealogy-graph/')) {
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