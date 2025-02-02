import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class FileSortPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        try {
            this._window = window;
            this.settings = this.getSettings();

            // Create main container
            const toolbarView = new Adw.ToolbarView();
            window.set_content(toolbarView);

            // HeaderBar
            const headerBar = new Adw.HeaderBar();
            this.applyButton = new Gtk.Button({
                label: 'Apply Changes',
                sensitive: false,
                css_classes: ['suggested-action']
            });
            
            this.applyButton.connect('clicked', () => {
                console.log('[FileSort] Applying pending changes');
                if (this.pendingChanges.folders) {
                    console.log('[FileSort] New configuration:', JSON.stringify(this.pendingChanges.folders, null, 2));
                    this.settings.set_string('folders', JSON.stringify(this.pendingChanges.folders));
                    this.pendingChanges.folders = null;
                    this.applyButton.set_sensitive(false);
                }
            });
        
            headerBar.pack_end(this.applyButton);
            toolbarView.add_top_bar(headerBar);

            // Preferences page setup
            const page = new Adw.PreferencesPage();
            const preferencesGroup = new Adw.PreferencesGroup();
            page.add(preferencesGroup);
            toolbarView.content = page; // Critical: Attach page to toolbarView

            // Folders group
            const foldersGroup = new Adw.PreferencesGroup({
                title: 'Monitored Folders',
                description: 'Folders to watch for automatic sorting'
            });
            page.add(foldersGroup);

            // Initialize pending changes with null safety
            const foldersJSON = this.settings.get_string('folders') || '[]'; // Handle empty/null case
            this.pendingChanges = {
                folders: JSON.parse(foldersJSON)
            };

            // Validate folders array
            if (!Array.isArray(this.pendingChanges.folders)) {
                console.warn('[FileSort] Invalid folders data. Resetting to empty array.');
                this.pendingChanges.folders = [];
            }

            // Load existing folders
            this.pendingChanges.folders.forEach(folder => {
                this._createFolderEntry(foldersGroup, folder);
            });

            // Add folder row
            const addFolderRow = new Adw.ActionRow({
                title: 'Add New Folder',
                activatable: true,
            });
            const addButton = new Gtk.Button({
                icon_name: 'folder-new-symbolic',
                tooltip_text: 'Add folder to monitor',
                valign: Gtk.Align.CENTER,
            });
            addButton.connect('clicked', () => {
                console.log('[FileSort] Adding new folder');
                const newFolder = {
                    path: GLib.get_home_dir() + '/NewFolder',
                    rules: []
                };
                this.pendingChanges.folders.push(newFolder);
                this.applyButton.set_sensitive(true);
                this._createFolderEntry(foldersGroup, newFolder);
            });
            addFolderRow.add_suffix(addButton);
            foldersGroup.add(addFolderRow);
        } catch(e) {
            console.error('[FileSort] Preferences init error:', e);
        }
    }

    _createFolderEntry(group, folder) {
        const expander = new Adw.ExpanderRow({
            title: folder.path,
            subtitle: `${folder.rules.length} rules`,
        });

        // Folder path selector
        const pathRow = new Adw.ActionRow({
            title: 'Folder Path',
        });
        
        const pathBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8
        });
        
        const pathLabel = new Gtk.Label({
            label: folder.path,
            xalign: 0,
            hexpand: true
        });
        
        const selectButton = new Gtk.Button({
            label: 'Change...',
            margin_start: 8
        });
        
        selectButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({
                title: 'Select Folder',
                modal: true,
                accept_label: 'Select'
            });
            
            dialog.select_folder(
                this._window,
                null,
                (_, res) => {
                    try {
                        const file = dialog.select_folder_finish(res);
                        if (!file) {
                            console.log('[FileSort] Folder selection cancelled');
                            return;
                        }
                        
                        const newPath = file.get_path();
                        console.log('[FileSort] Selected new path:', newPath);
                        const index = this.pendingChanges.folders.findIndex(f => f.path === folder.path);
                        if (index > -1) {
                            this.pendingChanges.folders[index].path = newPath;
                            folder.path = newPath; // Update local reference
                            pathLabel.label = newPath;
                            expander.title = newPath;
                            this.applyButton.set_sensitive(true);
                            console.log('[FileSort] Updated folder path in pending changes');
                        }
                    } catch(e) {
                        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            console.error('[FileSort] Folder selection error:', e.message);
                        }
                    }
                }
            );
        });
        
        pathBox.append(pathLabel);
        pathBox.append(selectButton);
        pathRow.add_suffix(pathBox);
        expander.add_row(pathRow);

        // Rules section
        const rulesGroup = new Adw.PreferencesGroup({
            title: 'Sorting Rules',
            margin_top: 12,
        });
        expander.add_row(rulesGroup);

        folder.rules.forEach((rule, index) => {
            this._createRuleEntry(rulesGroup, rule, folder, index);
        });

        // Add rule button
        const addRuleRow = new Adw.ActionRow({
            title: 'Add New Rule',
            activatable: true,
        });
        const addRuleButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
        });
        addRuleButton.connect('clicked', () => {
            console.log('[FileSort] Adding new rule to:', folder.path);
            const newRule = {
                name: 'New Rule',
                filter: { type: 'extension', value: [] },
                actions: []
            };
            const folderIndex = this.pendingChanges.folders.findIndex(f => f.path === folder.path);
            this.pendingChanges.folders[folderIndex].rules.push(newRule);
            this.applyButton.set_sensitive(true);
            this._createRuleEntry(rulesGroup, newRule, folder, this.pendingChanges.folders[folderIndex].rules.length - 1);
        });
        addRuleRow.add_suffix(addRuleButton);
        rulesGroup.add(addRuleRow);

        // Remove folder button
        const removeButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: 'Remove Folder',
            css_classes: ['destructive-action'],
        });
        removeButton.connect('clicked', () => {
            console.log('[FileSort] Removing folder:', folder.path);
            this.pendingChanges.folders = this.pendingChanges.folders.filter(f => f.path !== folder.path);
            this.applyButton.set_sensitive(true);
            group.remove(expander);
        });
        expander.add_suffix(removeButton);

        group.add(expander);
    }

    // Updated _createRuleEntry method signature
    _createRuleEntry(group, rule, folder, ruleIndex) {
        const expander = new Adw.ExpanderRow({
            title: rule.name,
        });

        // Rule name editor
        const nameRow = new Adw.EntryRow({
            title: 'Rule Name',
            text: rule.name,
        });
        nameRow.connect('changed', () => {
            const folders = JSON.parse(this.settings.get_string('folders'));
            const folderIndex = folders.findIndex(f => f.path === folder.path);
            if (folderIndex === -1) return;
            
            folders[folderIndex].rules[ruleIndex].name = nameRow.get_text();
            this.settings.set_string('folders', JSON.stringify(folders));
            expander.title = nameRow.get_text();
        });
        expander.add_row(nameRow);

        // Filter editor
        const filterExpander = new Adw.ExpanderRow({
            title: `Filter Type: ${rule.filter.type}`,
        });
        
        // Filter type selector
        const filterTypes = ['extension', 'size', 'date'];
        const filterTypeList = new Gtk.StringList();
        filterTypes.forEach(type => filterTypeList.append(type));
        
        const filterType = new Gtk.DropDown({
            model: filterTypeList,
            selected: filterTypes.indexOf(rule.filter.type)
        });
        filterType.connect('notify::selected', () => {
            const selected = filterType.get_selected();
            const newType = filterTypeList.get_string(selected);
            
            const folders = JSON.parse(this.settings.get_string('folders'));
            const folderIndex = folders.findIndex(f => f.path === folder.path);
            if (folderIndex === -1) return;
            
            folders[folderIndex].rules[ruleIndex].filter.type = newType;
            folders[folderIndex].rules[ruleIndex].filter.value = newType === 'extension' ? [] : '';
            this.settings.set_string('folders', JSON.stringify(folders));
            
            filterExpander.title = `Filter Type: ${newType}`;
            this._updateFilterUI(filterExpander, newType, folders[folderIndex].rules[ruleIndex].filter, folder, ruleIndex);
        });
        filterExpander.add_prefix(filterType);

        // Filter value editor
        this._updateFilterUI(filterExpander, rule.filter.type, rule.filter, folder, ruleIndex);
        expander.add_row(filterExpander);

        // Actions section
        const actionsGroup = new Adw.PreferencesGroup({
            title: 'Actions',
            margin_top: 12,
        });
        expander.add_row(actionsGroup);

        rule.actions.forEach((action, actionIndex) => {
            this._createActionEntry(actionsGroup, action, folder, ruleIndex, actionIndex); // FIXED: Removed settings param
        });

        // Add action button
        const addActionRow = new Adw.ActionRow({
            title: 'Add New Action',
            activatable: true,
        });
        const addActionButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
        });
        addActionButton.connect('clicked', () => {
            const folders = JSON.parse(this.settings.get_string('folders'));
            const folderIndex = folders.findIndex(f => f.path === folder.path);
            if (folderIndex === -1) return;
            
            const newAction = {
                type: 'move',
                destination: '',
                pattern: ''
            };
            
            folders[folderIndex].rules[ruleIndex].actions.push(newAction);
            this.settings.set_string('folders', JSON.stringify(folders));
            this._createActionEntry(actionsGroup, newAction, folder, ruleIndex, folders[folderIndex].rules[ruleIndex].actions.length - 1);
        });
        addActionRow.add_suffix(addActionButton);
        actionsGroup.add(addActionRow);

        // Remove rule button
        const removeButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: 'Remove Rule',
            css_classes: ['destructive-action'],
        });
        removeButton.connect('clicked', () => {
            const folders = JSON.parse(this.settings.get_string('folders'));
            const folderIndex = folders.findIndex(f => f.path === folder.path);
            if (folderIndex === -1) return;
            
            folders[folderIndex].rules.splice(ruleIndex, 1);
            this.settings.set_string('folders', JSON.stringify(folders));
            group.remove(expander);
        });
        expander.add_suffix(removeButton);

        group.add(expander);
    }

    _updateFilterUI(expander, filterType, filter, folder, ruleIndex) {
        // Clear existing UI safely
        const children = [];
        let child = expander.get_first_child();
        
        // Collect removable children
        while (child) {
            if (child !== expander.get_prefix()) {
                children.push(child);
            }
            child = child.get_next_sibling();
        }

        // Remove collected children
        children.forEach(c => expander.remove(c));

        // Add appropriate controls
        switch(filterType) {
            case 'extension':
                const extensionRow = new Adw.ActionRow({
                    title: 'File Extensions',
                });
                const entry = new Gtk.Entry({
                    text: filter.value.join(', '),
                    placeholder_text: 'jpg, png, txt...',
                });
                entry.connect('changed', () => {
                    console.log('[FileSort] Updating extensions:', entry.get_text());
                    const folderIndex = this.pendingChanges.folders.findIndex(f => f.path === folder.path);
                    this.pendingChanges.folders[folderIndex].rules[ruleIndex].filter.value = 
                        entry.get_text().split(',').map(e => e.trim().replace(/^\.?/, ''));
                    this.applyButton.set_sensitive(true);
                });
                extensionRow.add_suffix(entry);
                expander.add_row(extensionRow);
                break;

            case 'size':
                const sizeRow = new Adw.ActionRow({
                    title: 'File Size (KB)',
                });
                const sizeEntry = new Gtk.SpinButton({
                    adjustment: new Gtk.Adjustment({
                        lower: 0,
                        upper: 1000000,
                        step_increment: 100
                    }),
                    value: filter.value || 0
                });
                sizeEntry.connect('value-changed', () => {
                    console.log('[FileSort] Updating size filter:', sizeEntry.get_value());
                    const folderIndex = this.pendingChanges.folders.findIndex(f => f.path === folder.path);
                    this.pendingChanges.folders[folderIndex].rules[ruleIndex].filter.value = sizeEntry.get_value();
                    this.applyButton.set_sensitive(true);
                });
                sizeRow.add_suffix(sizeEntry);
                expander.add_row(sizeRow);
                break;

            case 'date':
                const dateRow = new Adw.ActionRow({
                    title: 'Modified After',
                });
                const dateEntry = new Gtk.Entry({
                    text: filter.value || '',
                    placeholder_text: 'YYYY-MM-DD',
                });
                dateEntry.connect('changed', () => {
                    console.log('[FileSort] Updating date filter:', dateEntry.get_text());
                    const folderIndex = this.pendingChanges.folders.findIndex(f => f.path === folder.path);
                    this.pendingChanges.folders[folderIndex].rules[ruleIndex].filter.value = dateEntry.get_text();
                    this.applyButton.set_sensitive(true);
                });
                dateRow.add_suffix(dateEntry);
                expander.add_row(dateRow);
                break;
        }
    }
    
    _createActionEntry(group, action, folder, ruleIndex, actionIndex) {
        const row = new Adw.ActionRow({
            title: action.type,
            subtitle: this._getActionDescription(action),
        });

        // Action type selector
        const actionTypes = ['move', 'rename', 'delete'];
        const stringList = new Gtk.StringList();
        actionTypes.forEach(type => stringList.append(type));

        const typeCombo = new Gtk.DropDown({
            model: stringList,
            selected: actionTypes.indexOf(action.type)
        });

        // Action parameters box
        const paramsBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });

        // Update parameters when type changes
        const updateParams = () => {
            // Clear existing params
            let child = paramsBox.get_first_child();
            while (child) {
                paramsBox.remove(child);
                child = paramsBox.get_first_child();
            }

            // Add appropriate controls
            switch(action.type) {
                case 'move':
                    const destButton = new Gtk.Button({
                        label: 'Select Destination...',
                        halign: Gtk.Align.START
                    });
                    
                    destButton.connect('clicked', () => {
                        const dialog = new Gtk.FileDialog({
                            title: 'Select Destination Folder',
                            modal: true,
                            accept_label: 'Select'
                        });
                        
                        dialog.select_folder(
                            this._window,
                            null,
                            (_, res) => {
                                try {
                                    const file = dialog.select_folder_finish(res);
                                    if (!file) {
                                        console.debug('Destination selection cancelled');
                                        return;
                                    }
                                    
                                    const destPath = file.get_path();
                                    const folders = JSON.parse(this.settings.get_string('folders')); // FIXED: Use this.settings
                                    const folderIndex = folders.findIndex(f => f.path === folder.path);
                                    if (folderIndex === -1) return;
                                    
                                    folders[folderIndex].rules[ruleIndex].actions[actionIndex].destination = destPath;
                                    this.settings.set_string('folders', JSON.stringify(folders)); // FIXED: Use this.settings
                                    row.subtitle = this._getActionDescription(folders[folderIndex].rules[ruleIndex].actions[actionIndex]);
                                } catch(e) {
                                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                                        console.error('Destination selection error:', e.message);
                                    }
                                }
                            }
                        );
                    });
                    
                    if (action.destination) {
                        const destLabel = new Gtk.Label({
                            label: action.destination,
                            xalign: 0,
                            margin_top: 8
                        });
                        paramsBox.append(destLabel);
                    }
                    paramsBox.append(destButton);
                    break;

                case 'rename':
                    const patternEntry = new Gtk.Entry({
                        text: action.pattern || '',
                        placeholder_text: '{date}-{filename}.{ext}',
                    });
                    patternEntry.connect('changed', () => {
                        const folders = JSON.parse(this.settings.get_string('folders')); // FIXED: Use this.settings
                        const folderIndex = folders.findIndex(f => f.path === folder.path);
                        if (folderIndex === -1) return;
                        
                        folders[folderIndex].rules[ruleIndex].actions[actionIndex].pattern = 
                            patternEntry.get_text();
                        this.settings.set_string('folders', JSON.stringify(folders)); // FIXED: Use this.settings
                        row.subtitle = this._getActionDescription(folders[folderIndex].rules[ruleIndex].actions[actionIndex]);
                    });
                    paramsBox.append(patternEntry);
                    break;
            }
        };

        typeCombo.connect('notify::selected', () => {
            const selected = typeCombo.get_selected();
            const newType = stringList.get_string(selected);
            
            const folders = JSON.parse(this.settings.get_string('folders')); // FIXED: Use this.settings
            const folderIndex = folders.findIndex(f => f.path === folder.path);
            if (folderIndex === -1) return;
            
            folders[folderIndex].rules[ruleIndex].actions[actionIndex] = {
                type: newType,
                ...(newType === 'move' ? { destination: '' } : {}),
                ...(newType === 'rename' ? { pattern: '' } : {})
            };
            this.settings.set_string('folders', JSON.stringify(folders)); // FIXED: Use this.settings
            
            row.title = newType;
            updateParams();
        });

        // Initial setup
        updateParams();
        typeCombo.notify('selected');

        row.add_suffix(typeCombo);
        row.add_suffix(paramsBox);
        group.add(row);
    }

    _getActionDescription(action) {
        switch(action.type) {
            case 'move': return `Move to: ${action.destination || 'Not set'}`;
            case 'rename': return `Pattern: ${action.pattern || 'Not set'}`;
            case 'delete': return 'Delete files';
            default: return 'Unknown action';
        }
    }
}
