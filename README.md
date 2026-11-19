# DCF Stock Valuation Calculator · DCF現金流估值模型

A free calculator that estimates what one share of a company is worth, based on the cash the business is expected to bring in over the next ten years. It started life as a Google Sheet and now opens as a page in your web browser, in English or Traditional Chinese.

![The calculator, showing a made-up example company](screenshot.png)

## Open it

1. Download the file called **index.html** from this page.
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

The version shared through claude.ai has an extra **Ask Claude** panel. It can fill in a company from just its ticker, suggest guesses, and answer questions about your valuation. That panel only works inside claude.ai, so it doesn't appear in this downloaded copy.

## Please note

- A valuation is only as good as its guesses. Small changes to growth or the discount rate can move the result a lot, so check the Sensitivity table.
- This calculator is for learning and planning. It is not financial advice.

---

## 繁體中文說明

這是一個免費的股票估值計算機，依照公司未來十年預期帶來的現金，估算每一股的合理價。

**開啟方式：** 下載 **index.html** 檔案，雙擊就會在瀏覽器（Chrome、Safari、Edge 或 Firefox）中開啟，不需要安裝或註冊。按右上角的 **EN / 繁中** 可以切換語言。

**使用步驟：**

1. 在上方輸入股票代號和公司名稱。
2. 選擇股價幣別和財報單位（通常是百萬）。如果財報幣別和股價不同，請選擇財報幣別並輸入匯率。
3. 從最新財報填入自由現金流、營收、現金、負債、股數和股價。
4. 為悲觀、基本、樂觀三種情境填入成長率等假設。
5. 在右邊查看合理價和安全邊際，再按「儲存快照」保存。

**儲存：** 紀錄會存在這台電腦的這個瀏覽器裡。換電腦、換瀏覽器或清除瀏覽紀錄後就會消失，建議定期按「匯出 CSV」備份。

**Ask Claude：** 在 claude.ai 開啟的版本有「詢問 Claude」功能，只要輸入股票代號就能自動填入數字。下載的版本沒有這個功能。

**注意：** 估值結果取決於你的假設，僅供學習和規劃參考，不構成投資建議。
