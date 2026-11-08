// Material 3 主题的图标表：宿主图标名 → Material Symbols（圆角）名。生成脚本和取图标的脚本共用。
// 每一项都对照过宿主原图的含义（node scripts/audit-theme.mjs --icons 会出一张原图 / 替换图对照表）。

export const ICONS = {
  // 键是宿主图标名（dsw-icon-<键>-regular / -medium），值是 Material Symbols 名；「:fill」取实心版
  // 侧栏、导航
  'panel-left-outline': 'side_navigation', 'new-chat-outline': 'edit_square', 'plugin-pinwheel-outline': 'extension', 'clock-outline': 'schedule',
  'alarm-clock-outline': 'alarm', 'apps-add-outline': 'category', 'search-outline': 'search',
  'sliders-two-outline': 'tune', 'project-add-outline': 'create_new_folder', 'folder-open': 'folder_open', 'folder-close': 'folder',
  'folder-open-outline': 'folder_open', 'flat-list-outline': 'format_list_bulleted', 'workspace-tree-outline': 'account_tree', 'drag-handle-outline': 'drag_handle',
  'settings-outline': 'settings', 'user-outline': 'person', 'users-outline': 'group', 'personalization-outline': 'tune',
  // 通用动作
  'ellipsis-outline': 'more_horiz', 'plus-outline': 'add', 'check-outline': 'check', 'close-outline': 'close', 'close-fill': 'close',
  'close-circle-fill': 'cancel:fill', 'chevron-down-outline': 'expand_more', 'chevron-up-outline': 'expand_less', 'chevron-left-outline': 'chevron_left',
  'chevron-right-outline': 'chevron_right', 'chevrons-up-down-outline': 'unfold_more', 'triangle-right-fill': 'arrow_right', 'copy-outline': 'content_copy',
  'refresh-outline': 'refresh', 'edit-outline': 'edit', 'trash-outline': 'delete', 'save-outline': 'save', 'download-outline': 'download',
  'share-outline': 'share', 'link-outline': 'link', 'right-up-outline': 'arrow_outward', 'fullscreen-outline': 'fullscreen', 'compare-split-outline': 'vertical_split',
  'archive-outline': 'archive', 'unarchive-outline': 'unarchive', 'archive-off-outline': 'hide_source', 'archive-check-outline': 'inventory_2',
  'pin-outline': 'keep', 'pin-fill': 'keep:fill', 'wrap-lines-outline': 'wrap_text', 'nowrap-fill': 'keyboard_tab', 'wrap-fill': 'wrap_text',
  // 对话
  'like-outline': 'thumb_up', 'like-fill': 'thumb_up:fill', 'dislike-outline': 'thumb_down', 'dislike-fill': 'thumb_down:fill', 'branch-outline': 'fork_right',
  'send-outline': 'arrow_upward', 'paper-plane-outline': 'send', 'stop-fill': 'stop:fill', 'paperclip-outline': 'attach_file', 'microphone-outline': 'mic',
  'loading-outline': 'progress_activity', 'play-outline': 'play_circle', 'pause-outline': 'pause_circle', 'think-outline': 'lightbulb', 'enhance-outline': 'notes',
  'sparkle': 'star_shine', 'agent-preset-outline': 'smart_toy', 'browse-outline': 'article', 'globe-outline': 'language', 'context-injection-outline': 'input',
  'deliver-doc': 'description', 'code-outline': 'tag', 'api-outline': 'terminal', 'cordis-plugin-outline': 'extension', 'skill-outline': 'book_2',
  'queue-outline': 'chat', 'checklist-outline': 'checklist', 'list-pen-outline': 'edit_note', 'goal-outline': 'track_changes', 'plan-outline': 'edit_document',
  'inspect-outline': 'code', 'compact-outline': 'compress', 'shield-outline': 'shield', 'gauge-outline': 'speed', 'data-outline': 'neurology',
  'database-outline': 'database',
  // 状态
  'check-circle-fill': 'check_circle:fill', 'check-circle-outline': 'check_circle', 'warning-outline': 'error', 'warning-triangle-outline': 'warning',
  'question-outline': 'help', 'info-outline': 'info',
  // 外观
  'light-outline': 'light_mode', 'dark-outline': 'dark_mode', 'followsystem-outline': 'computer',
  // 要写在 compact-outline 后面（名字里含它）
  'apps-add-compact-outline': 'category',
}

// 宿主少数图标的 viewBox 不是 16（在宿主雪碧图里量出来的）：缩放要跟着变，不然图标偏小或偏大
export const VB = { 'check-circle-fill': 36, 'info-outline': 14, 'skill-outline': 17, 'alarm-clock-outline': 17, 'unarchive-outline': 20 }
