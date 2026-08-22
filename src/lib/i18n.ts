import { useStore } from "@/state/store";

export type Language = "tr" | "en";

export const DICTIONARY = {
  tr: {
    // Common
    tempo: "Tempo",
    save: "Kaydet",
    cancel: "İptal",
    delete: "Sil",
    done: "Bitti",
    create: "Oluştur",
    add: "Ekle",
    edit: "Düzenle",
    allDay: "Tüm gün",
    today: "Bugün",
    tomorrow: "Yarın",
    loading: "Yükleniyor…",

    // Navigation
    navToday: "Bugün",
    navCalendar: "Takvim",
    navTasks: "Görevler",
    navPlans: "Planlar",
    navNotes: "Notlar",
    navFocus: "Odaklanma",
    navSettings: "Ayarlar",

    // Categories
    categories: "Kategoriler",
    newCategory: "Yeni kategori",
    editCategory: "Kategoriyi düzenle",
    clearFilter: "Filtreyi Temizle",
    categoryName: "Kategori adı",
    categoryColor: "Renk",

    // Settings Modal
    settingsTitle: "Ayarlar",
    language: "Dil / Language",
    langTr: "Türkçe (TR)",
    langEn: "English (EN)",
    appearance: "Görünüm",
    themeSystem: "Sistemle eşle",
    themeLight: "Açık tema",
    themeDark: "Koyu tema",
    weekStartsOnMonday: "Hafta Pazartesi başlasın",
    dayStarts: "Gün başlangıcı",
    dayStartsHint: "Hafta ve gün ızgaraları",
    dayEnds: "Gün bitişi",
    defaultReminder: "Varsayılan hatırlatıcı",
    defaultReminderHint: "Başlamadan önceki dakika",
    allDayTime: "Tüm gün saati",
    allDayTimeHint: "Tüm gün görevler için saat gerekirse kullanılır",
    notifications: "Bildirimler",
    notificationsHint: "Hatırlatıcılar yalnızca Tempo açıkken çalışır — arka plan servisi yoktur.",
    sendTestNotification: "Test bildirimi gönder",
    dataFile: "Veri dosyası",
    dataFileHint: "Düz JSON — diğer dosyalar gibi yedekleyebilir veya eşitleyebilirsiniz",
    reset: "Sıfırla",
    resetHint: "Tüm görevleri, hatırlatıcıları, kategorileri siler ve veri dosyasını boşaltır. Bu işlem geri alınamaz.",
    resetAllData: "Tüm verileri sıfırla",
    resetConfirm: "Evet, her şeyi sil",
    testNotifSuccess: "Gönderildi — bir bildirim başlığı görünmüş olmalı.",

    // Tasks & Plans
    assignToToday: "Bugüne Ata",
    removeFromToday: "Bugünden Kaldır",
    quickAddPlaceholder: "Yeni bir görev ekleyin… (Örn: Raporu hazırla ve ekibe gönder)",
    allTasks: "Tümü",
    highPriority: "Yüksek Öncelikli",
    overdue: "Gecikenler",
    completed: "Tamamlananlar",
    viewList: "Liste",
    viewPriority: "Öncelik Panosu",
    viewCategory: "Kategoriler",
    openTasksCount: "Açık Görev",
    overdueTasksCount: "Gecikenler",
    completedTasksCount: "Tamamlananlar",

    // Sync with Server
    syncWithServer: "Sunucu ile Eşitle",
    syncing: "Eşitleniyor…",
    syncUpToDate: "Verileriniz güncel! Herhangi bir fark bulunamadı.",
    syncSuccess: "Eşitleme tamamlandı:",
    syncLoginRequired: "Sunucuyla eşitlemek için lütfen önce giriş yapın.",
    syncOfflineNotice: "İnternet bağlantısı yok. Görevleriniz yerelde güvende saklanıyor.",
    searchTasksPlaceholder: "Görevlerde ara…",
    newTaskBtn: "Yeni görev",

    // Trash & Recycle Bin
    trash: "Çöp Kutusu",
    emptyTrash: "Çöpü Boşalt",
    emptyTrashConfirm: "Çöp kutusundaki tüm görevler kalıcı olarak silinecek. Emin misiniz?",
    restore: "Geri Al",
    permanentlyDelete: "Kalıcı Sil",
    permanentlyDeleteConfirm: "Bu görev kalıcı olarak silinecektir. Bu işlem geri alınamaz. Emin misiniz?",
    trashAutoPurgeNotice: "Silinen görevler 3 gün boyunca saklanır, ardından otomatik olarak kalıcı olarak silinir.",
    trashEmpty: "Çöp kutusu boş",
    trashEmptyHint: "Silinen görevler burada listelenir ve 3 gün içinde geri alınabilir.",
    deletedOn: "Silinme:",
    daysRemaining: "kaldı",
  },
  en: {
    // Common
    tempo: "Tempo",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    done: "Done",
    create: "Create",
    add: "Add",
    edit: "Edit",
    allDay: "All-day",
    today: "Today",
    tomorrow: "Tomorrow",
    loading: "Loading…",

    // Sync with Server
    syncWithServer: "Sync with Server",
    syncing: "Syncing…",
    syncUpToDate: "All data is up to date! No differences found.",
    syncSuccess: "Sync completed:",
    syncLoginRequired: "Please sign in to sync with the server.",
    syncOfflineNotice: "No internet connection. Your tasks are safely saved locally.",
    searchTasksPlaceholder: "Search tasks…",
    newTaskBtn: "New task",

    // Navigation
    navToday: "Today",
    navCalendar: "Calendar",
    navTasks: "Tasks",
    navPlans: "Plans",
    navNotes: "Notes",
    navFocus: "Focus",
    navSettings: "Settings",

    // Categories
    categories: "Categories",
    newCategory: "New category",
    editCategory: "Edit category",
    clearFilter: "Clear filter",
    categoryName: "Category name",
    categoryColor: "Colour",

    // Settings Modal
    settingsTitle: "Settings",
    language: "Language / Dil",
    langTr: "Türkçe (TR)",
    langEn: "English (EN)",
    appearance: "Appearance",
    themeSystem: "Match system",
    themeLight: "Light",
    themeDark: "Dark",
    weekStartsOnMonday: "Weeks start on Monday",
    dayStarts: "Day starts",
    dayStartsHint: "Week and day grids",
    dayEnds: "Day ends",
    defaultReminder: "Default reminder",
    defaultReminderHint: "Minutes before start",
    allDayTime: "All-day time",
    allDayTimeHint: "Used when an all-day task needs a clock time",
    notifications: "Notifications",
    notificationsHint: "Reminders only fire while Tempo is running — there is no background service.",
    sendTestNotification: "Send a test notification",
    dataFile: "Data file",
    dataFileHint: "Plain JSON — back it up or sync it like any other file",
    reset: "Reset",
    resetHint: "Erases every task, reminder, category and activity entry, and empties the data file. This cannot be undone.",
    resetAllData: "Reset all data",
    resetConfirm: "Yes, erase everything",
    testNotifSuccess: "Sent — a banner should have appeared.",

    // Tasks & Plans
    assignToToday: "Assign to Today",
    removeFromToday: "Remove from Today",
    quickAddPlaceholder: "Add a new task… (e.g. Prepare report and send to team)",
    allTasks: "All",
    highPriority: "High Priority",
    overdue: "Overdue",
    completed: "Completed",
    viewList: "List",
    viewPriority: "Priority Board",
    viewCategory: "Categories",
    openTasksCount: "Open Tasks",
    overdueTasksCount: "Overdue",
    completedTasksCount: "Completed",

    // Trash & Recycle Bin
    trash: "Trash",
    emptyTrash: "Empty Trash",
    emptyTrashConfirm: "All items in the trash will be permanently deleted. Are you sure?",
    restore: "Restore",
    permanentlyDelete: "Delete Permanently",
    permanentlyDeleteConfirm: "This task will be permanently deleted. This cannot be undone. Are you sure?",
    trashAutoPurgeNotice: "Deleted tasks are kept for 3 days, then permanently deleted automatically.",
    trashEmpty: "Trash is empty",
    trashEmptyHint: "Deleted tasks appear here and can be restored within 3 days.",
    deletedOn: "Deleted:",
    daysRemaining: "left",
  },
} as const;

export type TranslationKey = keyof typeof DICTIONARY.tr;

/**
 * Hook to retrieve the current language and translator function.
 */
export function useI18n() {
  const language = useStore((s) => (s.db.settings.language ?? "tr") as Language);
  const dict = DICTIONARY[language] ?? DICTIONARY.tr;

  const t = (key: TranslationKey, fallback?: string): string => {
    return (dict as Record<string, string>)[key] ?? fallback ?? key;
  };

  return { language, t, dict };
}
