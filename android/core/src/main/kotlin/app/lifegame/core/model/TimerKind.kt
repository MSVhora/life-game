package app.lifegame.core.model

/** The kinds of timer the server knows. [id] is what the API uses. */
enum class TimerKind(val id: String, val label: String) {
    WORK("work", "Work"),
    LUNCH("lunch", "Lunch"),
    DINNER("dinner", "Dinner"),
    WASH("wash", "Wash"),
    BATH("bath", "Bath"),
    SLEEP("sleep", "Sleep"),
    READING("reading", "Reading"),
    GAMING("gaming", "Gaming"),
    OUT("out", "Out"),
    OTHER("other", "Other");

    companion object {
        fun fromId(id: String?): TimerKind = entries.firstOrNull { it.id == id } ?: WORK
    }
}
