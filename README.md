# DCF Stock Valuation Calculator · DCF現金流估值模型

A free calculator that estimates what one share of a company is worth, based on the cash the business is expected to bring in over the next ten years. It started life as a Google Sheet and now opens as a page in your web browser, in English or Traditional Chinese.

![The calculator, showing a made-up example company](screenshot.png)

## Open it

1. Download the calculator. Under **Releases** on this page, open the newest one and download the file ending in **.html**, for example **dcf-calculator-v1.1.0.html**. (The file called **index.html** in the list above is the same thing, always the newest version.)
2. Double-click it. It opens in your web browser (Chrome, Safari, Edge or Firefox).

There is nothing to install and no account to create. The calculator opens with a made-up example company so you can see how it works. Press **New** to start your own.

## Value a stock in five steps

1. **Type the ticker and company name** at the top, for example NVDA and NVIDIA.
2. **Choose the units.** Pick the currency of the share price and the unit the company's report uses, usually millions. If the report uses a different currency from the share price (for example, a company that reports in US dollars but trades in Australia), choose the report's currency and type in the exchange rate.
3. **Copy in the company's numbers** from its latest annual or quarterly report. The table below shows where to find each one.
4. **Set your growth guesses** for three outcomes: bear (things go badly), base (most likely) and bull (things go well).
5. **Read the result** on the right, then press **Save snapshot** to keep a dated copy.

Tips:

- Press Enter to jump to the next box, like in a spreadsheet.
- Type numbers the way they appear in reports: 1,250 or 1.2B or 25億. Use (120) or -120 for a negative number.
- Type percentages as plain numbers: 12 means 12%. If you type 0.12, the calculator asks whether you meant 12%.

## The numbers you copy from the report

| Box | What it means | Where to find it |
|---|---|---|
| Free cash flow | Cash the business kept over the last 12 months after paying for buildings and equipment | Cash flow statement: "cash from operations" minus "capital expenditure" |
| Revenue | Total sales over the last 12 months | Income statement |
| Stock-based compensation (optional) | Pay given to staff in shares instead of cash | Cash flow statement |
| Cash & investments | Cash in the bank plus short-term investments | Balance sheet |
| Total debt | Loans and bonds the company must repay, not every bill it owes | Balance sheet: short-term plus long-term debt |
| Shares outstanding | How many shares exist | Front page of the report, or any stock website |
| Current share price | Today's price | Any stock website or your broker |
| Dividend per share (optional) | Dividends paid per share over the last year | The company's news releases |

## Your guesses

- **Growth, years 1–5 and 6–10:** how fast free cash flow grows each year. Growth usually slows as a company gets bigger.
- **Revenue × free cash flow margin:** a second way to look ahead, useful when a company's profits are unusually low or high right now. You set how fast sales grow and how much of each dollar of sales becomes free cash flow once things settle down.
- **Terminal growth:** growth after year 10, forever. Most people use 2–3%, about the pace of the wider economy.
- **Discount rate:** the yearly return you want from the investment. 8–12% is common. A higher number gives a lower value.
- **Bear, base and bull:** three versions of the future, each with its own guesses and a weight for how likely you think it is.

## Reading the result

- **Fair value per share:** what one share is worth if your guesses come true.
- **Margin of safety:** how far the fair value is above (+) or below (−) today's price.
- **BUY / HOLD / SELL:** by default, BUY needs a margin of safety of at least 25%, and SELL shows at −10% or worse. You can change both levels. Set both to 0 to match the original Google Sheet.
- **Weighted value and range:** the three outcomes blended by your weights, plus the lowest and highest values.
- **Price implies:** the growth that today's share price already assumes. If that looks too easy or too hard to achieve, it tells you something about the price.
- **Dividend checks:** the dividend yield, whether free cash flow is enough to pay the dividend, and a second estimate of value based only on dividends.
- **10-year projection and Sensitivity:** the year-by-year numbers, and how the value would change with a slightly different discount rate or terminal growth.
- **Input checks:** warnings when something looks wrong, such as a percentage typed the wrong way or numbers in mismatched units.

## Saving your work

- **Save snapshot** keeps a dated copy, grouped by ticker in the list on the left. Open a stock there to see every save, a chart of fair value against the share price over time, and buttons to load or delete each save.
- **Export CSV** saves your whole history as a spreadsheet file that opens in Excel or Google Sheets.
- Your saves stay on this computer, in the web browser you used. They don't move to another computer or browser, and clearing your browser's history and site data erases them. Export now and then to keep a copy.

## Language

Use the **EN / 繁中** button at the top right to switch between English and Traditional Chinese.

## Ask Claude

Claude, Anthropic's AI assistant, can do the research for you:

- **New model from a ticker:** type a ticker, such as NVDA or WTC.AX, and press **Build model**. Claude finds the company's latest figures, fills in every box and sets up the bear, base and bull outcomes. Everything it filled in is marked "Claude" until you change it, and **Undo** takes you back to what you had.
- **Suggest assumptions** or **Update figures + assumptions** for the stock on screen. You see each suggested change and choose which ones to keep.
- **Review my inputs:** a short list of what looks off and what to double-check.
- **Ask a question** about your valuation, such as "Is a 10% discount rate right here?"

### Connecting Claude

In the downloaded calculator, Claude needs your own Anthropic API key. That's a private code that lets the calculator use Claude for you.

1. Go to [console.anthropic.com](https://console.anthropic.com), sign in or create an account, and add some credit.
2. Open **API keys**, create a key and copy it.
3. In the calculator, paste it into **Connect Claude with your API key** and press **Connect**.

Good to know:

- What you use is charged to that Anthropic account. It's separate from any claude.ai subscription.
- Claude can search the web, so it finds a company's latest results and share price. It's still worth checking the numbers against the company's own report.
- Your key is kept only in the web browser on your computer, and is only sent to Anthropic. Don't connect it on a computer other people use. Press **Disconnect** to remove it.
- If web search is switched off on your Anthropic account, Claude still works but uses what it already knows, which may be out of date. The calculator tells you when that happens.

If you open the calculator inside claude.ai instead, it uses your claude.ai account, and you don't need a key.

## Version history

The version you have is shown at the bottom of the calculator.

- **1.1.0** (19 November 2026): Ask Claude now works in the downloaded calculator once you connect your own Anthropic API key, and Claude looks up the latest figures on the web.
- **1.0.0** (19 November 2026): the first public version.

When a new version comes out, download it the same way. Your saved snapshots stay in your web browser, so they're still there when you open the new file in the same browser.

## Please note

- A valuation is only as good as its guesses. Small changes to growth or the discount rate can move the result a lot, so check the Sensitivity table.
- This calculator is for learning and planning. It is not financial advice.

---

## 繁體中文說明

這是一個免費的股票估值計算機，依照公司未來十年預期帶來的現金，估算每一股的合理價。

**開啟方式：** 在本頁的 **Releases** 下載最新版本的 **.html** 檔案（例如 **dcf-calculator-v1.1.0.html**），雙擊就會在瀏覽器（Chrome、Safari、Edge 或 Firefox）中開啟，不需要安裝或註冊。按右上角的 **EN / 繁中** 可以切換語言。版本號碼顯示在頁面最下方，目前是 1.1.0。

**使用步驟：**

1. 在上方輸入股票代號和公司名稱。
2. 選擇股價幣別和財報單位（通常是百萬）。如果財報幣別和股價不同，請選擇財報幣別並輸入匯率。
3. 從最新財報填入自由現金流、營收、現金、負債、股數和股價。
4. 為悲觀、基本、樂觀三種情境填入成長率等假設。
5. 在右邊查看合理價和安全邊際，再按「儲存快照」保存。

**儲存：** 紀錄會存在這台電腦的這個瀏覽器裡。換電腦、換瀏覽器或清除瀏覽紀錄後就會消失，建議定期按「匯出 CSV」備份。

**詢問 Claude：** 輸入股票代號並按「建立模型」，Claude 會上網查詢最新數字、填好所有欄位，並設定三種情境。下載的版本需要你自己的 Anthropic API 金鑰：

1. 到 [console.anthropic.com](https://console.anthropic.com) 登入或註冊，並加值。
2. 在 **API keys** 建立金鑰並複製。
3. 貼到計算機的「用你的 API 金鑰連接 Claude」，再按「連接」。

使用費用記在你的 Anthropic 帳戶，和 claude.ai 方案分開計算。金鑰只會存在你這台電腦的瀏覽器裡，也只會傳送給 Anthropic；請不要在共用電腦上連接，按「中斷連接」即可移除。在 claude.ai 裡開啟的版本則使用你的 claude.ai 帳號，不需要金鑰。

**注意：** 估值結果取決於你的假設，僅供學習和規劃參考，不構成投資建議。
