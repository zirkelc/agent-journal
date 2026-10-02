import JournalKit
import SwiftUI

/**
 Picks a period like a calendar app: a year of months, a month of days, or a week of days. A click on
 a day selects that day, a click on a week number or on the title selects the whole span, and a month
 in the year view opens that month. The marks show how much was written, under the current filters.
 */
struct CalendarPicker: View {
  @Environment(AppModel.self) private var model
  private var calendar: Calendar { .autoupdatingCurrent }

  var body: some View {
    @Bindable var model = model

    VStack(spacing: 8) {
      PillSegments(
        selection: $model.pickerUnit,
        options: [.init(value: .year, title: "Year"), .init(value: .month, title: "Month"), .init(value: .week, title: "Week")],
        fillsWidth: true
      )

      header

      switch model.pickerUnit {
      case .year: yearGrid
      case .month: monthGrid
      case .week: weekList
      }
    }
  }

  private var shown: Period {
    Period(model.pickerUnit.periodUnit, containing: model.pickerAnchor)
  }

  private var header: some View {
    HStack {
      Button { model.pickerAnchor = shown.advanced(by: -1).start } label: { Image(systemName: "chevron.left") }
      Spacer()
      Button { model.select(shown) } label: {
        Text(headerTitle)
          .fontWeight(.semibold)
          .padding(.horizontal, 8)
          .padding(.vertical, 2)
          .background(model.period == shown ? Color.accentColor : .clear, in: RoundedRectangle(cornerRadius: 5))
          .foregroundStyle(model.period == shown ? Color.white : .primary)
      }
      .help("Show the whole \(model.pickerUnit.rawValue)")
      Spacer()
      Button { model.pickerAnchor = shown.advanced(by: 1).start } label: { Image(systemName: "chevron.right") }
    }
    .buttonStyle(.borderless)
  }

  private var headerTitle: String {
    switch model.pickerUnit {
    case .year: shown.start.formatted(.dateTime.year())
    case .month: shown.start.formatted(.dateTime.month(.wide).year())
    case .week: Style.title(for: shown).0
    }
  }

  // MARK: - Year

  private var yearGrid: some View {
    let months = (0..<12).compactMap { calendar.date(byAdding: .month, value: $0, to: shown.start) }.map { Period(.month, containing: $0) }
    let counts = months.map(model.count(in:))
    let maximum = max(counts.max() ?? 0, 1)

    return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
      ForEach(Array(months.enumerated()), id: \.offset) { index, month in
        let isSelected = model.period == month
        Button {
          model.select(month)
          model.pickerUnit = .month
        } label: {
          VStack(spacing: 2) {
            Text(month.start.formatted(.dateTime.month(.abbreviated)))
            Text(counts[index] == 0 ? "–" : counts[index].formatted())
              .font(.caption2)
              .monospacedDigit()
              .foregroundStyle(isSelected ? Color.white.opacity(0.8) : .secondary)
            Capsule()
              .fill(isSelected ? Color.white.opacity(0.6) : Color.accentColor.opacity(heat(counts[index], maximum)))
              .frame(height: 3)
              .padding(.horizontal, 8)
          }
          .padding(.vertical, 5)
          .frame(maxWidth: .infinity)
          .foregroundStyle(isSelected ? Color.white : .primary)
          .background(isSelected ? Color.accentColor : Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 7))
          .opacity(month.start > .now ? 0.45 : 1)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
  }

  // MARK: - Month

  private var monthGrid: some View {
    let month = shown.interval(in: calendar)
    let weeks = weeks(covering: month)
    let maximum = max(weeks.flatMap { $0.days() }.map { model.dayCounts[$0] ?? 0 }.max() ?? 0, 1)
    let selected = model.period?.interval(in: calendar)

    return Grid(horizontalSpacing: 0, verticalSpacing: 2) {
      GridRow {
        Text("")
        ForEach(Array(weekdaySymbols.enumerated()), id: \.offset) { _, symbol in
          Text(symbol)
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
      ForEach(weeks, id: \.start) { week in
        GridRow {
          Button { model.select(week) } label: {
            /** Laid out like a day cell, mark included, so the number sits on the same line as the days. */
            VStack(spacing: 1) {
              Text("\(calendar.component(.weekOfYear, from: week.start))")
                .font(.system(size: 9))
                .monospacedDigit()
                .foregroundStyle(model.period == week ? Color.accentColor : .secondary)
                .frame(height: 14)
              Color.clear.frame(width: 12, height: 3)
            }
            .frame(width: 20, height: 26)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .help("Show this week")

          ForEach(Array(week.days().enumerated()), id: \.element) { index, day in
            dayCell(day, column: index, inMonth: day >= month.start && day < month.end, selected: selected, maximum: maximum)
          }
        }
      }
    }
  }

  private func dayCell(_ day: Date, column: Int, inMonth: Bool, selected: DateInterval?, maximum: Int) -> some View {
    let count = model.dayCounts[day] ?? 0
    let isPicked = model.period == Period(.day, containing: day)
    let inRange = !isPicked && selected.map { day >= $0.start && day < $0.end } == true
    let isToday = calendar.isDateInToday(day)
    /** A range is one band per row, rounded where it starts and ends and where a row breaks it. */
    let next = calendar.date(byAdding: .day, value: 1, to: day) ?? day
    let leading: CGFloat = column == 0 || selected.map { day <= $0.start } == true ? 6 : 0
    let trailing: CGFloat = column == 6 || selected.map { next >= $0.end } == true ? 6 : 0

    return Button { model.select(Period(.day, containing: day)) } label: {
      VStack(spacing: 1) {
        Text(day.formatted(.dateTime.day()))
          .font(.system(size: 11, weight: isToday ? .bold : .regular))
          .monospacedDigit()
          .frame(height: 14)
          .foregroundStyle(isPicked ? Color.white : isToday ? Color.accentColor : inMonth && day <= .now ? .primary : .secondary)
        Capsule()
          .fill(isPicked ? Color.white.opacity(count == 0 ? 0 : 0.7) : Color.accentColor.opacity(heat(count, maximum)))
          .frame(width: 12, height: 3)
      }
      .frame(maxWidth: .infinity, minHeight: 26)
      .background {
        if isPicked {
          RoundedRectangle(cornerRadius: 6).fill(Color.accentColor)
        } else if inRange {
          UnevenRoundedRectangle(
            topLeadingRadius: leading, bottomLeadingRadius: leading,
            bottomTrailingRadius: trailing, topTrailingRadius: trailing
          )
          .fill(Color.accentColor.opacity(0.18))
        }
      }
      .opacity(inMonth ? 1 : 0.5)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(Style.count(count))
  }

  /** The weeks that overlap a month, each as a whole week, so the grid starts and ends on full rows. */
  private func weeks(covering month: DateInterval) -> [Period] {
    var weeks: [Period] = []
    var week = Period(.week, containing: month.start)
    while week.start < month.end {
      weeks.append(week)
      week = week.advanced(by: 1)
    }
    return weeks
  }

  /** The very short weekday names, starting from the calendar's first weekday. */
  private var weekdaySymbols: [String] {
    let symbols = calendar.veryShortStandaloneWeekdaySymbols
    let first = calendar.firstWeekday - 1
    return Array(symbols[first...] + symbols[..<first])
  }

  // MARK: - Week

  private var weekList: some View {
    let days = shown.days()
    let counts = days.map { model.dayCounts[$0] ?? 0 }
    let maximum = max(counts.max() ?? 0, 1)

    return VStack(spacing: 2) {
      ForEach(Array(days.enumerated()), id: \.offset) { index, day in
        let isPicked = model.period == Period(.day, containing: day)
        Button { model.select(Period(.day, containing: day)) } label: {
          HStack(spacing: 8) {
            Text(day.formatted(.dateTime.weekday(.abbreviated).day()))
              .frame(width: 64, alignment: .leading)
              .foregroundStyle(calendar.isDateInToday(day) ? Color.accentColor : .primary)
            GeometryReader { geometry in
              ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.08))
                Capsule().fill(Color.accentColor)
                  .frame(width: geometry.size.width * CGFloat(counts[index]) / CGFloat(maximum))
              }
            }
            .frame(height: 6)
            Text(counts[index] == 0 ? "" : counts[index].formatted())
              .font(.caption)
              .monospacedDigit()
              .foregroundStyle(.secondary)
              .frame(width: 24, alignment: .trailing)
          }
          .padding(.horizontal, 6)
          .padding(.vertical, 4)
          .background(isPicked ? Color.accentColor.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 5))
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
  }

  /** How strongly to draw a mark. Any entry at all shows clearly, and the busiest day is full strength. */
  private func heat(_ count: Int, _ maximum: Int) -> Double {
    count == 0 ? 0 : 0.25 + 0.75 * Double(count) / Double(maximum)
  }
}
