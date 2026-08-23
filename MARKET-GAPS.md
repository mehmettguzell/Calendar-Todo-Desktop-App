Tabii. Metnin anlamını ve teknik terimleri koruyarak doğal Türkçeye çeviriyorum:

# İnsanların aslında neden şikâyet ettiğini ve bizim bunlara ne yaptığımızı

Bir görev yöneticisi yapmak zor bir şey değildir; asıl zor olan, birinin onu kullanmaya devam etmesini sağlamaktır. Bu çalışma, insanların mevcut görev yöneticilerini neden bıraktığını inceleyip bunu yapılması gerekenlerin bir listesine dönüştürüyor — ve aynı zamanda bunlardan hangilerinin artık Tempo'da bulunduğunu kayda geçiriyor.

Kaynaklar özellikle kullanıcı odaklı seçildi; üretici/vendor kaynakları kullanılmadı. Çünkü inceleme siteleri ve topluluk tartışmaları **neyin yanlış gittiğini**, özellik sayfaları ise **neyin geliştirildiğini** söyler.

- [Why power users abandon Notion, Todoist & Trello (2026)](https://unstar.app/blog/productivity-app-reviews-what-power-users-complain-about-2026)
- [Task manager software Reddit users swear by (2026)](https://ones.com/blog/task-manager-software-reddit-users-swear-by-2026/)
- [The best task management app is the one you stop fighting](https://blog.toodledo.com/best-task-management-app-stop-fighting/)
- [Todoist vs TickTick (2026)](https://toolfinder.com/comparisons/todoist-vs-ticktick)
- [Natural language processing — feature request, tasks/tasks #784](https://github.com/tasks/tasks/issues/784)
- [Natural language task creation — ClickUp feature requests](https://feedback.clickup.com/feature-requests/p/natural-language-processing-in-task-creation-today-tomorrow-next-week-in-x-days-1)
- [Best time blocking apps (2026)](https://thedigitalprojectmanager.com/tools/best-time-blocking-app/)

---

## Şikâyetler — kullanıcıların uygulamayı bırakmasına yol açma sıklığına göre sıralanmış

### 1. Görev eklemek çok yavaş, bu yüzden insanlar görevlerini hiç kaydetmiyor

Formdaki bir sürü alanı doldurmak yerine `"çarşamba annemi ara"` yazabilmek, doğal dil girdisi olmayan neredeyse her uygulamada en çok istenen özelliklerden biri.

Bunun önemli olmasının nedeni estetik değil, tamamen mekanik: Altı alanı doldururken akılda tutulan bir düşünce, büyük ihtimalle kaybolur.

**Yapıldı.** `src/domain/naturalLanguage.ts`, tarihleri, saatleri ve zaman aralıklarını, tekrarı, önceliği, kategoriyi, etiketleri ve tahmini süreyi hem Türkçe hem İngilizce olarak, hatta ikisini aynı girdide karışık şekilde ayrıştırıyor.

Örneğin:

`yarın 14:00-16:00 proje sunumu #iş !1 @ofis ~90dk`

şuna dönüşüyor:

- Zaman: yarın, 14:00–16:00
- Kategori: iş
- Öncelik: yüksek
- Konum: ofis
- Tahmini süre: 90 dakika
- Görev adı: **proje sunumu**

Sistem anladığı her şeyi görev oluşturulmadan **önce chip'ler olarak gösteriyor**. Böylece yanlış bir tahmin ancak görev oluşturulduktan sonra fark edilmiyor; kullanıcı daha en başta ne anlaşıldığını görebiliyor.

Sistem bir şeyi anlayamazsa, girdiği metni olduğu gibi normal bir görev olarak oluşturuyor.

---

### 2. "Telefonda ve masaüstünde farklı şeyler görüyorum"

Senkronizasyon sırasında oluşan çakışmaların duplicate kayıtlar üretmesi ve yapılan değişikliklerin sessizce kaybolması, kullanıcıların sıkça karşılaştığı sorunlar arasında.

Bunun altında genellikle şu problem yatıyor: Uygulamanın iki tarafta da değişiklik yapıldığında **hangisinin kazanacağını belirleyen açık bir kuralı yok.**

**Yapıldı.** Tüm koleksiyonlarda uygulanan tek bir kural var:

- Satır seviyesinde `updated_at` değerine göre **last-write-wins**
- Eşitlik durumunda **cloud kazanıyor**
- Silmeler, her zaman kazanan **tombstone** kayıtları olarak tutuluyor

Bu kural `DECISIONS.md` §11'de yazılı ve dört farklı yerde ayrı ayrı uygulanmak yerine tek bir genel reconciler tarafından uygulanıyor.

---

### 3. Çalışmayan offline modları

Offline çalışma, farklı uygulamalarda kullanıcıların tekrar tekrar talep ettiği özelliklerden biri.

**Yapıldı.** Yerel yazma işlemi asıl commit işlemidir; cloud ise sonradan yetişen bir replika olarak çalışır.

Offline olmak:

- kullanıcının oturumunu kapatmaz,
- düzenleme yapmasını engellemez.

Reconciliation işlemi kuyruk üzerinden değil **içerik karşılaştırması** üzerinden çalıştığı için uygulamanın yeniden başlatılmasından sonra bile bir kuyruğun hayatta kalmasına gerek kalmaz.

`DECISIONS.md` §13.

---

### 4. "Uygulamayı açtım, 47 şey gördüm ve kapattım"

Aşırı yüklenmişlik hissi, insanların görev uygulamasını tamamen bırakmasının en sık dile getirilen nedenlerinden biri.

Dünün tamamlanmamış işlerinin sessizce ortadan kaybolması da zamanla büyük bir görev yığını oluşturuyor.

**Yapıldı.** Roll-over özelliğiyle dün tamamlanmamış kalan işler tek tıklamayla bugüne taşınabiliyor.

Bu işlem de tıpkı diğer yeniden planlamalar gibi geçmişte kaydediliyor.

Bunun **bilinçli olarak otomatik yapılmamasının** nedeni şu:

> Kendi kendine hareket eden bir görevin son teslim tarihine artık güvenemezsiniz.

Tekrarlayan görev serileri ve tamamlanmış işler hiçbir zaman taşınmıyor.

---

### 5. Her şeye ulaşamayan arama ve klavye ile kullanım eksikliği

"Her içerikte daha iyi arama" ve hızlı görev oluşturma kısayolları, kullanıcıların sıkça istediği özellikler arasında.

Bir şeyi bulmak için fareye uzanmak, o anda akılda tutulan düşüncenin kaybolmasına neden olabiliyor.

**Yapıldı.** `Ctrl/Cmd+K` ile açılan komut paleti üzerinden:

- görevlerde arama yapılabiliyor,
- herhangi bir görünüme geçilebiliyor,
- görev oluşturulabiliyor,
- senkronizasyon başlatılabiliyor,
- ayarlar açılabiliyor.

Açık görevler tamamlanmış görevlerin üzerinde sıralanıyor.

Ayrıca bir görev, arama sonuçlarından çıkmadan ve tamamen klavye üzerinden tamamlanabiliyor.

---

### 6. Planlanan süre ile gerçek sürenin hiç kaydedilmemesi

Time-blocking kullanan kişiler özellikle planlanan süre ile gerçek sürenin her blok için karşılaştırılmasını istiyor.

Çünkü bir sonraki tahmini gerçekten iyileştiren tek şey, **ne kadar süre planladığın ile gerçekte ne kadar sürdüğünü karşılaştırmak.**

**Yapıldı.** Görevlerin artık bir tahmini süresi var.

Örneğin:

`~90dk`

ile hızlı ekleme yapılabiliyor veya görev panelinden süre girilebiliyor.

Mevcut focus timer ise gerçek harcanan süreyi sağlıyor.

Panelde:

`actual/estimate · %ratio`

gösteriliyor ve iş planlanan sürenin üzerine çıktıysa buna göre görsel olarak belirtiliyor.

---

### 7. Bildirimlerin sessizce çalışmaması

Bir hatırlatıcının hiç gelmemesi ile işletim sisteminin bildirimi engellemesi, uygulamanın içinden bakıldığında aynı görünebilir.

**Yapıldı.** Desktop bildirim sistemi artık işletim sisteminin verdiği cevabı geri döndürüyor. Dolayısıyla işletim sistemi bildirimi reddederse bu durum kullanıcıdan gizlenmiyor; bunun yerine kullanıcıya bir mesaj gösteriliyor.

Uygulama içindeki kart ise her durumda gösterilen teslimat yöntemi.

Bu kartta:

- Complete
- Snooze
- Open

işlemleri bulunuyor.

Hem desktop bildirimi hem de uygulama içindeki kart aynı payload builder'dan beslendiği için aynı hatırlatıcıyı farklı şekilde tanımlayamıyorlar.

Bu builder ayrıca unit testlerle test ediliyor. Testler şu durumları da kapsıyor:

- görev tamamlanmışsa,
- ertelenmişse,
- çöpe atılmışsa,
- bildirimin zamanı zaten geçmişse.

---

### 8. Özellik şişkinliği: "Her uygulama istemediğim Pomodoro timer'larını ekleyip duruyor"

Aslında sevilen uygulamalar hakkında yapılan en yaygın şikâyetlerden biri bu.

Önemli çünkü yukarıdaki maddelerin tam tersi.

**Bir özellik olarak değil, bir tasarım kısıtı olarak uygulandı.**

Eklenen her şey ya kullanılana kadar görünmez durumda:

- doğal dil ile görev oluşturma,
- komut paleti,
- roll-over butonu yalnızca taşınacak bir şey olduğunda görünür.

Ya da kendi navigation öğesinin arkasında duruyor:

- Budget.

Zaten çalışan bir ekrana yeni bir özellik eklenmedi.

---

### 9. Performans: "Bir sayfanın açılması 8 saniye sürüyor", "Yazarken gecikme oluyor"

**Yapısal olarak ele alındı ve zaten çözülmüş durumda.**

Belgenin tamamı bellekte tutuluyor.

Bir yazma işlemi doğrudan state güncellemesi.

Disk yazma işlemi debounce ediliyor, cloud yazma işlemi ise batch halinde yapılıyor.

Dolayısıyla bunların hiçbiri kullanıcı etkileşiminin kritik yolunda değil.

`DECISIONS.md` §12.

---

### 10. Aslında tek uygulama olması gereken dört ayrı uygulamaya para ödemek

Kullanıcılar ayrı bir tracker, ayrı bir dashboard ve ayrı bir notes uygulaması kullanmak zorunda olmaktan rahatsız olduklarını belirtiyor.

**Kısmen yapıldı.**

Calendar, tasks, notes, focus tracking, plans ve artık budget; tek bir belge üzerinde çalışan tek bir uygulamada birleşiyor.

Budget'ın eklenmesine sebep olan ihtiyaç şuydu:

- günlük gelir/gider/yatırım,
- haftalık gelir/gider/yatırım,
- aylık gelir/gider/yatırım,
- "Bu ay bütçemin ne kadar altındayım?"
- paranın nereye gittiği,
- kullanıcının yazdığı şeylerden otomatik olarak büyüyen bir kategori listesi.

Kategori listesi sabit bir enum'a bağlı değil.

---

## Bilinçli olarak değerlendirilen ama yapılmayanlar

| Eksik özellik                                                      | Neden yapılmadı?                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **İki yönlü Google/Outlook Calendar senkronizasyonu**              | Gerçekten ihtiyaç duyulan ve sık talep edilen bir özellik. Ancak OAuth entegrasyonu ve kendi conflict kurallarına sahip ikinci bir sync engine gerektiriyor. Yani bir özellikten ziyade başlı başına bir proje. §11'deki merge kuralı bunun ileride üzerine inşa edilebileceği temel. |
| **Mobil/masaüstü widget'ları**                                     | Her platform için native bir yüzey gerekiyor. Mevcut shell buna ulaşamıyor.                                                                                                                                                                                                           |
| **AI ile görev parçalama / otomatik zamanlama**                    | Şikâyet listesi tam tersini söylüyor: insanlar istemedikleri özelliklerin eklenmesinden rahatsız oluyor. Bu özelliğin gerçekten yerini hak etmesi gerekiyor.                                                                                                                          |
| **Takım paylaşımı, yorumlar, görev atama**                         | Bu artık farklı bir ürün olurdu. Buradaki single-source-of-truth modeli tek kişinin verisi ve her satır için tek bir RLS policy üzerine kurulmuş.                                                                                                                                     |
| **Pomodoro preset'leri, mevcut olanın ötesinde habit streak'leri** | Kullanıcıların özellikle bloat olarak şikâyet ettiği şeyler arasında.                                                                                                                                                                                                                 |

---

## Temel fikir

Yukarıdaki şikâyetlerin çoğunu iki temel başarısızlık türü açıklıyor ve bunlar birbirinin tam tersi yönde hareket ediyor:

### **Sürtünme (Friction)**

- Görev oluşturmanın çok uzun sürmesi
- Aramanın istediğin şeye ulaşamaması
- İşlerin kaybolması

Bunların çözümü **adımları azaltmak.**

### **Şişkinlik (Bloat)**

- Kimsenin istemediği özellikler
- Önceden basit olan ekranlara sürekli yeni şeyler eklemek

Bunun sebebi ise **adımlar eklemek.**

Buradaki her özellik için uygulanan temel test şu:

> **"İnsanların zaten yaptığı bir şeyden bir adımı ortadan kaldırıyor mu?"**

Doğal dil ile görev oluşturma, komut paleti ve roll-over bu testi geçiyor.

İkinci bir timer veya daha "akıllı" bir scheduler ise geçmiyor.
