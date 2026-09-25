static partial class Curriculum
{
    private static readonly VersionStamp ElectricalFoundationsDocs = new(
        "Electrical engineering",
        "Foundations",
        "2026-09-25",
        "https://www.allaboutcircuits.com/textbook/direct-current/");

    private static Exercise ChoiceExercise(string title, string prompt, string correct, Choice[] choices, string hint, params string[] tests) =>
        new(ExerciseKind.MultipleChoice, title, prompt, ["Choose the best answer"], null, correct, choices, hint, tests);

    private static Exercise NumericExercise(
        string title,
        string prompt,
        double expected,
        double tolerance,
        string unit,
        string hint,
        string workedSolution,
        IReadOnlyDictionary<string, double>? conversions = null) =>
        new(ExerciseKind.Numeric, title, prompt, ["Calculate the value", "Enter the numeric result and choose a unit"], null, null, [], hint, ["Applies the governing relationship", "Uses compatible units"], expected, tolerance, unit, conversions, workedSolution);

    private static Lesson[] BuildElectricalEngineeringLessons()
    {
        var currentConversions = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase)
        {
            ["A"] = 1000d,
            ["mA"] = 1d
        };
        var resistanceConversions = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase)
        {
            ["Ω"] = 1d,
            ["ohm"] = 1d,
            ["kΩ"] = 1000d,
            ["kohm"] = 1000d
        };
        var timeConversions = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase)
        {
            ["s"] = 1d,
            ["ms"] = 0.001d
        };
        var frequencyConversions = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase)
        {
            ["Hz"] = 1d,
            ["kHz"] = 1000d
        };

        return NormalizeLessons(
        [
            new(
                "ee-charge-voltage-current",
                "Electrical fundamentals",
                1,
                "Charge, voltage, and current",
                "Build a physical mental model before reaching for equations.",
                "Voltage is potential difference; current is charge flow.",
                "Electric charge is a property of matter. A voltage source establishes an electric potential difference that can push charge through a conductive path. Current tells you how quickly charge crosses a point. Conventional current is defined from positive toward negative even though electrons in metals drift the other way.",
                "source → potential difference → closed path → charge flow → load",
                ChoiceExercise("Name the quantity", "Which quantity describes the rate of electric charge flow?", "current", [new("current", "Current"), new("voltage", "Voltage"), new("resistance", "Resistance")], "Think about coulombs crossing a point per second.", "Distinguishes voltage from current"),
                null,
                ElectricalFoundationsDocs),
            new(
                "ee-resistance-circuits",
                "Electrical fundamentals",
                2,
                "Resistance and closed circuits",
                "A circuit only transfers energy when there is a complete path.",
                "Resistance opposes current; sources provide energy and loads use it.",
                "Conductors allow charge to move relatively easily; insulators resist that motion. A useful circuit needs a source, a closed conductive path, and one or more loads. An open switch breaks the path, so current stops even if voltage is still present across the opening.",
                "source ─ switch ─ resistor/load ─ return to source",
                ChoiceExercise("Reason about an open circuit", "A 9 V battery is connected to a lamp through an open switch. What happens?", "no-current", [new("no-current", "Voltage can exist, but the open path prevents current"), new("full-current", "Current flows normally"), new("short", "The battery is shorted")], "A source can establish voltage without a complete current path.", "Explains closed-circuit behavior"),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-ohms-law",
                "Ohm's law and basic circuit analysis",
                3,
                "Ohm's law: V = IR",
                "Relate voltage, current, and resistance as three views of one circuit relationship.",
                "For an ohmic resistor, V = IR.",
                "Ohm's law lets you solve for the missing quantity when the other two are known. Rearranging gives I = V/R and R = V/I. Keep units compatible before calculating: volts, amps, and ohms are the base forms.",
                "V = I × R\nI = V / R\nR = V / I",
                NumericExercise("Calculate resistor current", "A 12 V source is connected across a 330 Ω resistor. What current flows?", 36.36, 0.1, "mA", "Use I = V / R, then convert amperes to milliamps.", "I = V / R\nI = 12 V / 330 Ω\nI = 0.03636 A\nI = 36.36 mA", currentConversions),
                null,
                ElectricalFoundationsDocs),
            new(
                "ee-unit-conversion",
                "Ohm's law and basic circuit analysis",
                4,
                "Engineering units and prefixes",
                "Prefixes are scale factors, not decorations.",
                "milli means 10⁻³, kilo means 10³, and mega means 10⁶.",
                "Electrical work constantly moves between A and mA or Ω, kΩ, and MΩ. Convert first or carry prefixes carefully. A 4.7 kΩ resistor is 4700 Ω; 2 mA is 0.002 A.",
                "4.7 kΩ = 4700 Ω\n2 mA = 0.002 A",
                NumericExercise("Convert resistance", "Convert 4.7 kΩ to ohms.", 4700, 0.01, "Ω", "kilo means multiply by 1000.", "4.7 kΩ × 1000 = 4700 Ω", resistanceConversions),
                null,
                ElectricalFoundationsDocs),
            new(
                "ee-series-parallel",
                "Ohm's law and basic circuit analysis",
                5,
                "Series and parallel resistance",
                "Series adds one path; parallel adds alternate paths.",
                "Series resistances add directly; parallel networks reduce total resistance.",
                "In series, the same current flows through each resistor, so equivalent resistance is R₁ + R₂ + …. In parallel, each branch sees the same voltage and conductances add: 1/Rₑq = 1/R₁ + 1/R₂ + ….",
                "Series: Rₑq = R₁ + R₂\nParallel: 1/Rₑq = 1/R₁ + 1/R₂",
                NumericExercise("Find parallel resistance", "Two 1 kΩ resistors are connected in parallel. What is the equivalent resistance?", 500, 0.1, "Ω", "Equal resistors in parallel divide by the number of branches.", "1/Rₑq = 1/1000 + 1/1000 = 2/1000\nRₑq = 500 Ω", resistanceConversions),
                null,
                ElectricalFoundationsDocs),
            new(
                "ee-voltage-divider",
                "Ohm's law and basic circuit analysis",
                6,
                "Voltage and current division",
                "Series networks divide voltage; parallel networks divide current.",
                "A voltage divider follows the fraction of total series resistance.",
                "For two series resistors, the voltage across R₂ is Vout = Vin × R₂/(R₁ + R₂). Current division follows the inverse-resistance relationship because lower-resistance parallel branches carry more current.",
                "Vin ─ R1 ─●─ R2 ─ 0 V\n          │\n        Vout",
                NumericExercise("Solve a voltage divider", "A 10 V source feeds 1 kΩ in series with 1 kΩ. What is the midpoint voltage?", 5, 0.01, "V", "Equal series resistors split the source voltage equally.", "Vout = 10 V × 1 kΩ / (1 kΩ + 1 kΩ)\nVout = 5 V"),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-power-energy",
                "Power and energy",
                7,
                "Power, energy, and ratings",
                "Power is the rate of energy transfer.",
                "P = VI, with equivalent resistor forms P = I²R and P = V²/R.",
                "Power is measured in watts. Energy accumulates over time, so a 1 W load running for an hour uses 1 Wh. Component ratings matter because electrical energy becomes heat. Good engineering keeps normal dissipation comfortably below a component's maximum rating.",
                "P = VI = I²R = V²/R",
                NumericExercise("Calculate resistor power", "A 100 Ω resistor has 5 V across it. How much power does it dissipate?", 0.25, 0.001, "W", "Use P = V²/R.", "P = V²/R\nP = 25 / 100\nP = 0.25 W"),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-kirchhoff",
                "Kirchhoff's laws",
                8,
                "Nodes, loops, KCL, and KVL",
                "Kirchhoff's laws are conservation laws written for circuits.",
                "KCL conserves charge at a node; KVL conserves energy around a loop.",
                "A node joins conductive paths, a branch connects two nodes through an element, and a loop is a closed route. Kirchhoff's Current Law says currents entering and leaving a node balance. Kirchhoff's Voltage Law says signed voltage changes around a closed loop sum to zero.",
                "KCL: ΣI = 0 at a node\nKVL: ΣV = 0 around a loop",
                NumericExercise("Apply KCL", "At a node, 8 mA enters. Two branches carry away 3 mA and 1.5 mA. How much current leaves through the third branch?", 3.5, 0.01, "mA", "Outgoing current must equal incoming current.", "8 mA = 3 mA + 1.5 mA + I\nI = 3.5 mA", currentConversions),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-schematics",
                "Schematics and real circuits",
                9,
                "Read schematics as relationships",
                "A schematic shows electrical connectivity, not physical layout.",
                "Wires and node dots communicate connection; symbols communicate component roles.",
                "Reference ground is the circuit's chosen zero-volt reference and is not automatically literal Earth ground. Resistors, capacitors, inductors, diodes, switches, LEDs, transistor symbols, sources, and connectors are read by how their pins join nodes. Trace the source, then the paths, then the return.",
                "+5 V ─ resistor ─▶| LED ─ 0 V\n          current →",
                ChoiceExercise("Interpret ground", "What does a ground symbol most reliably mean on a low-voltage schematic?", "reference", [new("reference", "The circuit's reference potential"), new("earth", "A guaranteed physical Earth connection"), new("negative", "Always a negative power rail")], "Ground is fundamentally a reference node in circuit analysis.", "Distinguishes reference ground from Earth ground"),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-multimeter",
                "Measurement and multimeters",
                10,
                "Measure without becoming part of the fault",
                "Voltage measurements go across nodes; current measurements become part of the current path.",
                "Use the meter mode and lead placement that match the quantity.",
                "Voltage is measured in parallel because a voltmeter compares two node potentials and has high input impedance. Current is measured in series because the meter must carry the branch current and presents a low resistance path. Resistance and continuity are normally measured on de-energized circuits. For learning, stay with isolated low-voltage DC; do not use household mains or other high-energy systems as practice targets.",
                "Voltage: meter across two nodes\nCurrent: open path and insert meter\nResistance/continuity: power off",
                ChoiceExercise("Choose the safe setup", "How should you measure the voltage across a 5 V resistor circuit?", "parallel", [new("parallel", "Place the voltmeter across the two resistor nodes"), new("series", "Break the circuit and insert the voltmeter in series"), new("ohms-live", "Use resistance mode while energized")], "Voltage is a difference between two node potentials.", "Uses safe measurement topology"),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-capacitors-rc",
                "Capacitors and RC behavior",
                11,
                "Capacitance and RC time",
                "A capacitor stores separated charge and changes voltage over time.",
                "The RC time constant τ = RC sets the characteristic charging and discharging timescale.",
                "Capacitance is measured in farads, commonly µF and nF in practical circuits. In a DC RC circuit, a capacitor initially changes most quickly and approaches its final voltage asymptotically. After one time constant it has completed about 63% of a charging step.",
                "τ = R × C\nAt 1τ: about 63% charged",
                NumericExercise("Find the RC time constant", "A 10 kΩ resistor and 100 µF capacitor form an RC circuit. What is τ?", 1, 0.01, "s", "Convert 10 kΩ to 10,000 Ω and 100 µF to 0.0001 F.", "τ = RC\nτ = 10,000 Ω × 0.0001 F\nτ = 1 s", timeConversions),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-inductors",
                "Inductors and magnetic behavior",
                12,
                "Inductance, coils, and flyback",
                "Inductors store energy in magnetic fields and oppose rapid changes in current.",
                "Current through an inductor cannot change instantaneously without producing voltage.",
                "Inductance is measured in henries. Motors, relays, and solenoids contain inductive windings; interrupting current can create a large flyback voltage. Low-voltage DC designs commonly provide a diode or other clamp path so stored magnetic energy can dissipate safely.",
                "supply ─ coil ─ switch\n         ↘ flyback diode path",
                ChoiceExercise("Protect a coil switch", "Why is a flyback diode often placed across a DC relay coil?", "clamp", [new("clamp", "To provide a path for inductive current and limit voltage spikes"), new("boost", "To increase the relay voltage"), new("logic", "To invert the control signal")], "The magnetic field stores energy that must go somewhere when the switch opens.", "Explains inductive protection"),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-ac-fundamentals",
                "AC fundamentals",
                13,
                "Waveforms, frequency, RMS, and phase",
                "AC describes quantities that vary with time.",
                "Frequency and period are reciprocal: f = 1/T.",
                "A sine wave has amplitude, frequency, period, and phase. Peak voltage is the maximum magnitude from zero. RMS is an effective-value measure useful for comparing heating effects. Advanced impedance and phasor analysis belong in AC Circuit Analysis.",
                "f = 1/T\nT = 1/f",
                NumericExercise("Convert period to frequency", "A periodic waveform repeats every 2 ms. What is its frequency?", 500, 0.1, "Hz", "Convert 2 ms to 0.002 s, then use f = 1/T.", "T = 2 ms = 0.002 s\nf = 1 / 0.002 s\nf = 500 Hz", frequencyConversions),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-semiconductors",
                "Semiconductor foundations",
                14,
                "Diodes, LEDs, and transistor switches",
                "Semiconductors let circuits steer current with direction and control signals.",
                "Diodes conduct preferentially in one direction; transistors can act as electrically controlled switches.",
                "A forward-biased diode has a characteristic voltage drop; reverse bias normally blocks current until breakdown. LEDs need current limiting. BJTs are current-controlled devices at a high level, while MOSFETs are voltage-controlled at the gate. Both can let a small control signal manage a larger load within device ratings.",
                "+5 V ─ resistor ─ LED ─ 0 V\nGPIO ─ control → transistor → load",
                NumericExercise("Choose an LED resistor", "A 5 V source drives an LED with a 2 V forward drop at 10 mA. What series resistance is required?", 300, 1, "Ω", "The resistor sees 5 V - 2 V = 3 V. Use R = V/I.", "V_R = 5 V - 2 V = 3 V\nR = 3 V / 0.010 A\nR = 300 Ω", resistanceConversions),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-digital-electrical",
                "Digital electrical fundamentals",
                15,
                "Logic levels, pull resistors, and GPIO",
                "Digital logic is still analog voltage underneath.",
                "High and low are voltage ranges, not abstract truth values floating outside the circuit.",
                "Inputs need defined voltages. Pull-up and pull-down resistors establish a default state when no active driver is present; otherwise an input can float and react unpredictably to noise. Open-drain/open-collector outputs can pull a line one direction and rely on a resistor for the other state. GPIO is the bridge from a digital processor to real electrical nodes.",
                "Vcc\n │\n R pull-up\n │\n ├── input\n │\n switch\n │\n0 V",
                ChoiceExercise("Prevent a floating input", "A pushbutton input has no defined voltage when the switch is open. What simple component commonly fixes this?", "pull", [new("pull", "A pull-up or pull-down resistor"), new("capacitor", "A large series capacitor"), new("fuse", "A fuse")], "Give the input a weak default connection to a known rail.", "Connects digital logic to voltage levels"),
                null,
                ElectricalFoundationsDocs),

            new(
                "ee-engineering-habits",
                "Practical engineering habits",
                16,
                "Datasheets, tolerances, and systematic debugging",
                "Engineering gets safer and faster when assumptions become measurements.",
                "Read operating limits, design with margin, document the circuit, and debug one hypothesis at a time.",
                "Datasheets separate absolute maximum ratings from recommended operating conditions. Real components have tolerances and should be derated when heat, voltage, or current stress matters. Decoupling capacitors help local supplies stay stable; grounding and layout affect noise. Breadboards are useful prototypes, but draw the schematic first. When a circuit fails, verify power, references, expected node voltages, continuity, and signal flow instead of changing parts at random.",
                "schematic → expected values → measure → compare → isolate → fix",
                ChoiceExercise("Debug systematically", "A new low-voltage circuit does not work. What is the strongest first debugging habit?", "measure", [new("measure", "Compare measured power and node voltages with expected values"), new("replace", "Replace every component immediately"), new("raise-voltage", "Increase the supply voltage until it works")], "Turn assumptions into observations.", "Uses datasheets and measurement-driven debugging"),
                null,
                ElectricalFoundationsDocs)
        ]);
    }
}
