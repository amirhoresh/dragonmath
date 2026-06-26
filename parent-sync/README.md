# DragonMath — parent progress emails

Get a **weekly review** of your child's practice, plus an **alert if she hasn't
practiced for more than 3 days** — by email, without picking up her tablet.

The app stays offline-first and private. The only thing that leaves the device is
a tiny stats snapshot, sent **to a Google Apps Script you own** (your Google
account, no third party). The script does the emailing on a schedule.

## Setup (about 10 minutes, once)

1. Open <https://script.google.com> and click **New project**.
2. Delete the sample `function myFunction() {}` and **paste the entire contents of
   [`Code.gs`](./Code.gs)**.
3. Near the top, change `PARENT_EMAIL` to your email address.
4. Click **Run ▸ setup**. Google will ask you to review permissions — approve them
   (it needs to send email and run on a schedule). This installs the weekly +
   daily schedules.
5. Click **Deploy ▸ New deployment**. Choose type **Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone
   Click **Deploy** and **copy the Web app URL** (it ends in `/exec`).
6. In DragonMath, tap the **⚙️** (top-right of the home screen) → **Parent area**.
   Paste the URL into **Parent sync URL**, optionally type the child's name, and
   tap **Save**.
7. Tap **Send test**. Within a minute you should get a "test email — setup works!"
   message. Done.

## What you'll receive

- **Weekly review** (Sunday ~8am): days practiced, questions answered, first-try
  accuracy, total slip-ups, stars, dragon stage, the **topics she struggles with
  most** (slips per question), and her **hardest individual facts**.
- **Idle alert**: if she goes more than **3 days** without practicing, you get one
  email (it won't repeat until she practices again).

## Notes

- The app pushes a fresh snapshot every time a round ends (and when it's opened),
  whenever the tablet is online. If it's offline, nothing is lost — it syncs next
  time there's a connection.
- To change the idle threshold, edit `IDLE_DAYS` in `Code.gs` and redeploy.
- To stop syncing, just clear the URL in the Parent area and tap Save.
