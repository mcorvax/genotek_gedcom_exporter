# Genotek GEDCOM Exporter

This script allows you to export your Genotek genealogical tree as a standard GEDCOM file. You can open this file in family tree software like GRAMPS, Family Tree Maker, and others.

## Features

- Adds a "Скачать GEDCOM" button to the Genotek interface
- Exports your full genealogical tree in `.ged` format
- Clean, valid GEDCOM 5.5.1 output with no GRAMPS warnings

## Installation

### 1. Install Tampermonkey

Tampermonkey is a browser extension that lets you run custom JavaScript on websites.

Download and install Tampermonkey for your browser:

- [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/dhhpefjklgkmgeafimnjhojgjamoafof)

After installation, you will see a Tampermonkey icon in your browser's toolbar. In Firefox, it may appear as a black square.

### 2. Install the Script

1. Open the script file: [`genotek_gedcom_export.user.js`](./genotek_gedcom_export.user.js)
2. Tampermonkey will prompt you to install it
3. Click "Install"

### 3. Export Your Tree

1. Go to [https://lk.genotek.ru](https://lk.genotek.ru)
2. Open your genealogical tree
3. Wait for the page to load
4. Click the "Скачать GEDCOM" button near the zoom controls
   
   ![image](https://github.com/user-attachments/assets/7c7712f2-80fc-496d-b5a1-3ef85ec6d4fe)

6. The file will download automatically

## Compatibility

- Tested in Firefox
- Works with Tampermonkey extension
- GEDCOM files are compatible with GRAMPS and other genealogy software

## Contributions

Feel free to open issues, fork the repo, or submit pull requests.

## Powered by People and AI

This tool was built with human curiosity and machine fluency. Thanks, ChatGPT!
