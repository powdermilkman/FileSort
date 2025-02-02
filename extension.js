import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class FileSortExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._monitors = [];
        this._settings = null;
        this._folders = [];
        this.pendingChanges = {}; // Track changes before applying
    }


    enable() {
        this._settings = this.getSettings();
        //this._initializeDefaultFolders();
        this._setupMonitors();
        console.log('[FileSort] Extension enabled');
        
        // Listen for settings changes
        this._settings.connect('changed::folders', () => {
            console.log('[FileSort] Settings changed:', this._settings.get_string('folders'));
            this._loadConfig();
        });
    }

    disable() {
        this._monitors.forEach(monitor => monitor.cancel());
        this._monitors = [];
        this._settings = null;
        this._folders = [];
    }

    _loadConfig() {
        try {
            const json = this._settings.get_string('folders');
            console.log('[FileSort] Loading config:', json);
            this._folders = JSON.parse(json);
            
            // Initialize default config if empty
            if (this._folders.length === 0) {
                console.log('[FileSort] Initializing default config');
                this._folders = [{
                    path: GLib.get_home_dir() + '/Downloads',
                    rules: [{
                        name: 'Example Rule',
                        filter: {
                            type: 'extension',
                            value: ['jpg', 'png']
                        },
                        actions: [{
                            type: 'move',
                            destination: GLib.get_home_dir() + '/Pictures',
                            pattern: '{date}-{filename}'
                        }]
                    }]
                }];
                this._saveConfig();
            }
        } catch(e) {
            console.error('[FileSort] Config load error:', e);
        }
    }

    _saveConfig() {
        const json = JSON.stringify(this._folders, null, 2);
        console.log('[FileSort] Saving config:', json);
        this._settings.set_string('folders', json);
    }

    _setupMonitors() {
        this._folders.forEach(folder => {
            this._setupMonitor(folder.path);
        });
    }

    _setupMonitor(folderPath) {
        try {
            const dir = Gio.File.new_for_path(folderPath);
            if (!dir.query_exists(null)) return;

            const monitor = dir.monitor_directory(
                Gio.FileMonitorFlags.NONE, 
                null
            );
            
            monitor.connect('changed', (monitor, file, otherFile, eventType) => {
                if (eventType === Gio.FileMonitorEvent.CREATED) {
                    this._processFile(file, folderPath);
                }
            });
            
            this._monitors.push(monitor);
        } catch(e) {
            console.error(`FileSort monitor error: ${e.message}`);
        }
    }

    _processFile(file, baseFolder) {
        console.log(`[FileSort] Processing file: ${file.get_path()}`);
        const fileName = file.get_basename();

        // Skip hidden files and directories
        if (fileName.startsWith('.') || 
            file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY) {
            return;
        }

        const folderConfig = this._folders.find(f => f.path === baseFolder);
        if (!folderConfig) return;
        
        folderConfig.rules.forEach(rule => {
            if (this._matchesFilter(file, rule.filter)) {
                this._applyActions(file, rule.actions);
            }
        });
    }

    _matchesFilter(file, filter) {
        const fileInfo = file.query_info('*', Gio.FileQueryInfoFlags.NONE, null);
        
        switch(filter.type) {
            case 'extension':
                const ext = file.get_basename().split('.').pop().toLowerCase();
                return filter.value.includes(ext);
                
            case 'size':
                const fileSize = fileInfo.get_size();
                const targetSize = filter.value;
                switch(filter.operator) {
                    case '>': return fileSize > targetSize;
                    case '<': return fileSize < targetSize;
                    default: return fileSize === targetSize;
                }
                
            case 'date':
                const fileDate = fileInfo.get_modification_date_time().to_unix();
                const filterDate = GLib.DateTime.new_from_iso8601(filter.date, null).to_unix();
                return fileDate >= filterDate && fileDate < filterDate + 86400;
                
            default: 
                return false;
        }
    }

    _applyActions(file, actions) {
        let currentFile = file;
        
        actions.forEach(action => {
            try {
                switch(action.type) {
                    case 'move':
                        console.log(`[FileSort] Moving to: ${action.destination}`);
                        const destDir = Gio.File.new_for_path(action.destination);
                        if (!destDir.query_exists(null)) {
                            destDir.make_directory_with_parents(null);
                        }
                        const destPath = GLib.build_filenamev([
                            action.destination, 
                            currentFile.get_basename()
                        ]);
                        currentFile.move(
                            Gio.File.new_for_path(destPath), 
                            Gio.FileCopyFlags.OVERWRITE, 
                            null, 
                            null
                        );
                        currentFile = Gio.File.new_for_path(destPath);
                        break;
                        
                    case 'rename':
                        console.log(`[FileSort] Renaming with pattern: ${action.pattern}`);
                        const newName = this._substituteVariables(currentFile, action.pattern);
                        const newFile = currentFile.get_parent().get_child(newName);
                        currentFile.move(
                            newFile, 
                            Gio.FileCopyFlags.OVERWRITE, 
                            null, 
                            null
                        );
                        currentFile = newFile;
                        break;
                        
                    case 'delete':
                        console.log('[FileSort] Deleting file');
                        currentFile.trash(null);
                        break;
                }
            } catch(e) {
                console.error(`[FileSort] Action failed: ${e.message}`);
            }
        });
    }

    _substituteVariables(file, pattern) {
        const now = GLib.DateTime.new_now_local();
        const vars = {
            '{filename}': file.get_basename().replace(/\.[^.]+$/, ''),
            '{date}': now.format('%Y-%m-%d'),
            '{time}': now.format('%H-%M'),
            '{username}': GLib.get_user_name(),
            '{ext}': file.get_basename().split('.').pop()
        };
        return pattern.replace(/{[^}]+}/g, match => vars[match] || match);
    }
}
