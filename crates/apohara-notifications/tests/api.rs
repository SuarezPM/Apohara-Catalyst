use apohara_notifications::{fire, set_global_notifier, Notification, NotifyError, Notifier, Urgency};

struct CollectingNotifier {
    pub sent: std::sync::Mutex<Vec<Notification>>,
}

impl Notifier for CollectingNotifier {
    fn notify(&self, n: Notification) -> Result<(), NotifyError> {
        self.sent.lock().unwrap().push(n);
        Ok(())
    }
}

#[test]
fn fires_through_global_notifier() {
    let collector = std::sync::Arc::new(CollectingNotifier {
        sent: Default::default(),
    });
    set_global_notifier(collector.clone() as std::sync::Arc<dyn Notifier>);

    fire(Notification {
        title: "Apohara".into(),
        body: "Needs your attention".into(),
        urgency: Urgency::Critical,
        sound: Some("apohara-needs-you".into()),
    });

    let sent = collector.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].title, "Apohara");
    assert_eq!(sent[0].urgency, Urgency::Critical);
}
