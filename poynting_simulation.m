% =========================================================================
% 포인팅 효과 물리 시뮬레이터
% Based on Zurlo et al. (2020), Am. J. Phys. 88, 1036-1040
% =========================================================================
% 단일 MATLAB 스크립트입니다. 실행:
%   poynting_simulation
% =========================================================================

clear; clc; close all;

app = create_app();
refresh_app(app, app.current_display_turns);

%% ========================================================================
%  앱 생성
% =========================================================================
function app = create_app()
    app.constants.g = 9.81;
    app.constants.psi_to_pa = 6894.76;
    app.constants.sample_count = 240;
    app.constants.animation_frames = 90;
    app.constants.animation_pause_s = 0.025;
    app.constants.min_root_tol = 1e-10;
    app.constants.twist_control_max_turns = 6;
    app.constants.torque_control_max_Nm = 0.04143536;

    app.defaults.H_mm = 1000;      % 초기 높이 [mm]
    app.defaults.Re_mm = 4.0;      % 초기 반지름 [mm]
    app.defaults.mu_psi = 400;     % 전단 탄성률 [psi]
    app.defaults.mass_kg = 0.3;    % 매달린 질량 [kg]

    app.slider_defs = {
        'H',          '초기 높이',      'mm',      200, 1000, app.defaults.H_mm,     '%.0f'
        'R_e',        '초기 반지름',    'mm',     2.00, 30.0, app.defaults.Re_mm,     '%.2f'
        'mu',         '전단 탄성률',    'psi',     50, 2000, app.defaults.mu_psi,    '%.0f'
        'm',          '매달린 질량',    'kg',    0.00, 2.00, app.defaults.mass_kg,   '%.3f'
    };

    app.is_animating = false;
    app.pause_requested = false;
    app.current_data = [];
    app.current_params = [];
    app.current_display_turns = 0;
    app.listeners = {};

    app.fig = figure( ...
        'Position', [35, 35, 1540, 900], ...
        'Name', '포인팅 효과 시뮬레이터 (비압축성 고무 원기둥)', ...
        'Color', [0.96 0.96 0.95], ...
        'NumberTitle', 'off', ...
        'Resize', 'on', ...
        'MenuBar', 'none', ...
        'ToolBar', 'figure');

    app = create_layout(app);
    app = create_input_controls(app);
    app = create_mode_controls(app);
    app = create_animation_controls(app);
    app = create_output_controls(app);
    app = create_status_bar(app);
    app = apply_text_contrast(app);

    for idx = 1:numel(app.sliders)
        app.listeners{idx} = addlistener(app.sliders(idx), 'Value', 'PostSet', ...
            @(src, evt) slider_callback(app.fig));
    end

    set(app.panels.mode, 'SelectionChangedFcn', @(src, evt) mode_callback(app.fig));

    set(app.fig, 'UserData', app);
end

function app = create_layout(app)
    app.panels.left = uipanel(app.fig, ...
        'Title', '', ...
        'Units', 'normalized', ...
        'Position', [0.006, 0.055, 0.225, 0.935], ...
        'BackgroundColor', [0.96 0.96 0.95]);

    app.panels.center = uipanel(app.fig, ...
        'Title', '', ...
        'Units', 'normalized', ...
        'Position', [0.238, 0.055, 0.452, 0.935], ...
        'BackgroundColor', [0.985 0.985 0.98]);

    app.panels.right = uipanel(app.fig, ...
        'Title', '', ...
        'Units', 'normalized', ...
        'Position', [0.697, 0.055, 0.297, 0.935], ...
        'BackgroundColor', [0.985 0.985 0.98]);

    app.panels.inputs = uipanel(app.panels.left, ...
        'Title', '1. 입력 변수', ...
        'FontSize', 11, ...
        'FontWeight', 'bold', ...
        'Units', 'normalized', ...
        'Position', [0.02, 0.50, 0.96, 0.48], ...
        'BackgroundColor', [0.96 0.96 0.95]);

    app.panels.mode = uibuttongroup(app.panels.left, ...
        'Title', '2. 계산 모드', ...
        'FontSize', 11, ...
        'FontWeight', 'bold', ...
        'Units', 'normalized', ...
        'Position', [0.02, 0.34, 0.96, 0.15], ...
        'BackgroundColor', [0.96 0.96 0.95]);

    app.panels.animation = uipanel(app.panels.left, ...
        'Title', '3. 애니메이션', ...
        'FontSize', 11, ...
        'FontWeight', 'bold', ...
        'Units', 'normalized', ...
        'Position', [0.02, 0.02, 0.96, 0.31], ...
        'BackgroundColor', [0.96 0.96 0.95]);

    app.panels.visual = uipanel(app.panels.center, ...
        'Title', '4. 3D 시각화', ...
        'FontSize', 11, ...
        'FontWeight', 'bold', ...
        'Units', 'normalized', ...
        'Position', [0.02, 0.285, 0.96, 0.695], ...
        'BackgroundColor', [0.985 0.985 0.98]);

    app.panels.output = uipanel(app.panels.center, ...
        'Title', '수치 출력', ...
        'FontSize', 10, ...
        'Units', 'normalized', ...
        'Position', [0.02, 0.02, 0.96, 0.245], ...
        'BackgroundColor', [0.985 0.985 0.98]);

    app.panels.graphs = uipanel(app.panels.right, ...
        'Title', '5. 그래프', ...
        'FontSize', 11, ...
        'FontWeight', 'bold', ...
        'Units', 'normalized', ...
        'Position', [0.02, 0.25, 0.96, 0.73], ...
        'BackgroundColor', [0.985 0.985 0.98]);

    app.panels.equations = uipanel(app.panels.right, ...
        'Title', '6. 지배 방정식', ...
        'FontSize', 11, ...
        'FontWeight', 'bold', ...
        'Units', 'normalized', ...
        'Position', [0.02, 0.02, 0.96, 0.21], ...
        'BackgroundColor', [0.985 0.985 0.98]);

    app.ax3d = axes(app.panels.visual, ...
        'Units', 'normalized', ...
        'Position', [0.08, 0.10, 0.84, 0.82]);

    app.axElongation = axes(app.panels.graphs, ...
        'Units', 'normalized', ...
        'Position', [0.16, 0.55, 0.78, 0.35]);
    app.axHeight = axes(app.panels.graphs, ...
        'Units', 'normalized', ...
        'Position', [0.16, 0.10, 0.78, 0.35]);
    app.axRadius = axes(app.panels.graphs, ...
        'Units', 'normalized', ...
        'Position', [0.16, 0.08, 0.78, 0.24], ...
        'Visible', 'off');

    app.axEquations = axes(app.panels.equations, ...
        'Units', 'normalized', ...
        'Position', [0.03, 0.02, 0.94, 0.90], ...
        'Visible', 'off');
end

function app = create_input_controls(app)
    n = size(app.slider_defs, 1);
    app.sliders = gobjects(1, n);
    app.edit_boxes = gobjects(1, n);
    app.value_labels = gobjects(1, n);

    for idx = 1:n
        y = 0.83 - (idx - 1) * 0.155;
        symbol_text = app.slider_defs{idx, 1};
        name_text = app.slider_defs{idx, 2};
        unit_text = app.slider_defs{idx, 3};
        min_val = app.slider_defs{idx, 4};
        max_val = app.slider_defs{idx, 5};
        value = app.slider_defs{idx, 6};

        uicontrol(app.panels.inputs, 'Style', 'text', ...
            'String', sprintf('%s   %s (%s)', name_text, symbol_text, unit_text), ...
            'Units', 'normalized', ...
            'Position', [0.05, y + 0.070, 0.70, 0.070], ...
            'FontSize', 9.5, ...
            'FontWeight', 'bold', ...
            'BackgroundColor', [0.96 0.96 0.95], ...
            'HorizontalAlignment', 'left');

        app.value_labels(idx) = uicontrol(app.panels.inputs, 'Style', 'text', ...
            'String', sprintf('%.3g - %.3g', min_val, max_val), ...
            'Units', 'normalized', ...
            'Position', [0.05, y - 0.055, 0.59, 0.055], ...
            'FontSize', 8, ...
            'ForegroundColor', [0.25 0.25 0.25], ...
            'BackgroundColor', [0.96 0.96 0.95], ...
            'HorizontalAlignment', 'left');

        app.sliders(idx) = uicontrol(app.panels.inputs, 'Style', 'slider', ...
            'Min', min_val, ...
            'Max', max_val, ...
            'Value', value, ...
            'Units', 'normalized', ...
            'Position', [0.05, y + 0.020, 0.61, 0.055], ...
            'Tag', symbol_text);

        callback_idx = idx;
        app.edit_boxes(idx) = uicontrol(app.panels.inputs, 'Style', 'edit', ...
            'String', format_control_value(value, app.slider_defs{idx, 7}), ...
            'Units', 'normalized', ...
            'Position', [0.75, y + 0.010, 0.20, 0.080], ...
            'FontSize', 9.5, ...
            'BackgroundColor', 'w', ...
            'Callback', @(src, evt) edit_callback(app.fig, callback_idx));
    end
end

function app = create_mode_controls(app)
    app.mode_buttons.force = uicontrol(app.panels.mode, 'Style', 'radiobutton', ...
        'String', '비틀림 각도 지정 (Eq. 15)', ...
        'Units', 'normalized', ...
        'Position', [0.07, 0.58, 0.86, 0.25], ...
        'FontSize', 9, ...
        'BackgroundColor', [0.96 0.96 0.95], ...
        'Tag', 'force_twist');

    app.mode_buttons.torque = uicontrol(app.panels.mode, 'Style', 'radiobutton', ...
        'String', '토크 지정 (Sec. VII)', ...
        'Units', 'normalized', ...
        'Position', [0.07, 0.22, 0.86, 0.25], ...
        'FontSize', 9, ...
        'BackgroundColor', [0.96 0.96 0.95], ...
        'Tag', 'torque_control');

    set(app.panels.mode, 'SelectedObject', app.mode_buttons.force);
end

function app = create_animation_controls(app)
    app.buttons.play = uicontrol(app.panels.animation, 'Style', 'pushbutton', ...
        'String', '▶ 재생', ...
        'Units', 'normalized', ...
        'Position', [0.06, 0.58, 0.26, 0.28], ...
        'FontSize', 9.5, ...
        'FontWeight', 'bold', ...
        'ForegroundColor', [0.05 0.45 0.14], ...
        'Callback', @(src, evt) animate_callback(app.fig));

    app.buttons.pause = uicontrol(app.panels.animation, 'Style', 'pushbutton', ...
        'String', 'Ⅱ 일시정지', ...
        'Units', 'normalized', ...
        'Position', [0.37, 0.58, 0.28, 0.28], ...
        'FontSize', 9.5, ...
        'Enable', 'off', ...
        'Callback', @(src, evt) pause_callback(app.fig));

    app.buttons.reset = uicontrol(app.panels.animation, 'Style', 'pushbutton', ...
        'String', '↻ 초기화', ...
        'Units', 'normalized', ...
        'Position', [0.70, 0.58, 0.24, 0.28], ...
        'FontSize', 9.5, ...
        'Callback', @(src, evt) reset_callback(app.fig));

    app.controls.show_reference = uicontrol(app.panels.animation, 'Style', 'checkbox', ...
        'String', '변형 전 기준 원기둥 표시', ...
        'Value', 1, ...
        'Units', 'normalized', ...
        'Position', [0.07, 0.18, 0.86, 0.24], ...
        'FontSize', 9, ...
        'BackgroundColor', [0.96 0.96 0.95], ...
        'Callback', @(src, evt) checkbox_callback(app.fig));
end

function app = create_output_controls(app)
    labels = {
        'equilibrium_height', '평형 높이  h'
        'equilibrium_radius', '평형 반지름  r'
        'elongation',         '전체 신장  h - H'
        'twist_delta',        '추가 신장  h(theta)-h(0)'
        'relative_height',    '상대 높이  h / H'
        'initial_volume',     '초기 부피'
        'current_volume',     '현재 부피'
        'volume_ratio',       '부피비'
        'force',              '하중  F=mg'
        'torque',             '토크  M'
    };

    app.readouts = struct();
    for idx = 1:size(labels, 1)
        col = mod(idx - 1, 5);
        row = floor((idx - 1) / 5);
        x = 0.025 + col * 0.19;
        y_label = 0.75 - row * 0.42;
        y_value = 0.55 - row * 0.42;

        uicontrol(app.panels.output, 'Style', 'text', ...
            'String', labels{idx, 2}, ...
            'Units', 'normalized', ...
            'Position', [x, y_label, 0.17, 0.15], ...
            'FontSize', 8, ...
            'FontWeight', 'bold', ...
            'BackgroundColor', [0.985 0.985 0.98], ...
            'HorizontalAlignment', 'left');

        app.readouts.(labels{idx, 1}) = uicontrol(app.panels.output, 'Style', 'text', ...
            'String', '--', ...
            'Units', 'normalized', ...
            'Position', [x, y_value, 0.17, 0.16], ...
            'FontSize', 8.5, ...
            'BackgroundColor', [0.985 0.985 0.98], ...
            'HorizontalAlignment', 'left');
    end
end

function app = create_status_bar(app)
    app.status = uicontrol(app.fig, 'Style', 'text', ...
        'String', '상태: 준비됨', ...
        'Units', 'normalized', ...
        'Position', [0.006, 0.008, 0.988, 0.035], ...
        'FontSize', 9.5, ...
        'BackgroundColor', [0.98 0.98 0.98], ...
        'HorizontalAlignment', 'left');
end

function app = apply_text_contrast(app)
    dark_text = [0.08 0.08 0.08];
    panel_names = fieldnames(app.panels);
    for idx = 1:numel(panel_names)
        set(app.panels.(panel_names{idx}), 'ForegroundColor', dark_text);
    end

    text_controls = findall(app.fig, 'Type', 'uicontrol', 'Style', 'text');
    set(text_controls, 'ForegroundColor', dark_text, 'FontWeight', 'bold');

    radio_controls = findall(app.fig, 'Type', 'uicontrol', 'Style', 'radiobutton');
    set(radio_controls, 'ForegroundColor', dark_text, 'FontWeight', 'bold');

    check_controls = findall(app.fig, 'Type', 'uicontrol', 'Style', 'checkbox');
    set(check_controls, 'ForegroundColor', dark_text, 'FontWeight', 'bold');

    readout_names = fieldnames(app.readouts);
    for idx = 1:numel(readout_names)
        set(app.readouts.(readout_names{idx}), ...
            'ForegroundColor', [0.02 0.02 0.02], ...
            'FontWeight', 'bold');
    end
end

%% ========================================================================
%  콜백
% =========================================================================
function slider_callback(fig)
    if ~ishandle(fig)
        return;
    end

    app = get(fig, 'UserData');
    if app.is_animating
        return;
    end

    params = read_params_from_ui(app);
    refresh_app(app, clamp_display_control(app.current_display_turns, params));
end

function edit_callback(fig, idx)
    app = get(fig, 'UserData');
    if app.is_animating
        return;
    end

    raw_value = str2double(get(app.edit_boxes(idx), 'String'));
    min_val = get(app.sliders(idx), 'Min');
    max_val = get(app.sliders(idx), 'Max');
    old_value = get(app.sliders(idx), 'Value');

    if isnan(raw_value) || ~isfinite(raw_value)
        raw_value = old_value;
    end

    raw_value = max(min_val, min(max_val, raw_value));
    set(app.sliders(idx), 'Value', raw_value);
    params = read_params_from_ui(app);
    refresh_app(app, clamp_display_control(app.current_display_turns, params));
end

function mode_callback(fig)
    app = get(fig, 'UserData');
    if app.is_animating
        return;
    end

    params = read_params_from_ui(app);
    refresh_app(app, clamp_display_control(app.current_display_turns, params));
end

function checkbox_callback(fig)
    app = get(fig, 'UserData');
    if app.is_animating
        return;
    end

    params = read_params_from_ui(app);
    refresh_app(app, clamp_display_control(app.current_display_turns, params));
end

function reset_callback(fig)
    app = get(fig, 'UserData');
    if app.is_animating
        return;
    end

    defaults = app.defaults;
    set(app.sliders(1), 'Value', defaults.H_mm);
    set(app.sliders(2), 'Value', defaults.Re_mm);
    set(app.sliders(3), 'Value', defaults.mu_psi);
    set(app.sliders(4), 'Value', defaults.mass_kg);
    set(app.panels.mode, 'SelectedObject', app.mode_buttons.force);
    set(app.controls.show_reference, 'Value', 1);
    app.current_display_turns = 0;

    set(fig, 'UserData', app);
    refresh_app(app, app.current_display_turns);
end

function pause_callback(fig)
    app = get(fig, 'UserData');
    if app.is_animating
        app.pause_requested = true;
        set(app.status, 'String', '상태: 일시정지 요청됨...');
        set(fig, 'UserData', app);
    end
end

function animate_callback(fig)
    app = get(fig, 'UserData');
    if app.is_animating
        return;
    end

    app.is_animating = true;
    app.pause_requested = false;
    set(app.buttons.play, 'Enable', 'off');
    set(app.buttons.pause, 'Enable', 'on');
    set(app.status, 'String', '상태: 애니메이션 재생 중...');
    set(fig, 'UserData', app);
    drawnow;

    params = read_params_from_ui(app);
    data = compute_poynting_data(params.H, params.Re_m, params.mu_pa, ...
        params.mass_kg, params.max_turns, params.max_torque_Nm, app.constants);
    start_control = clamp_display_control(app.current_display_turns, params);
    max_control = get_control_max(params);
    if start_control >= max_control
        start_control = 0;
    end
    frames = linspace(start_control, max_control, app.constants.animation_frames);

    for frame_idx = 1:numel(frames)
        if ~ishandle(fig)
            return;
        end

        app = get(fig, 'UserData');
        if app.pause_requested
            break;
        end

        render_visualization(app, data, params, frames(frame_idx));
        render_graphs(app, data, params, frames(frame_idx));
        update_outputs(app, data, params, frames(frame_idx));
        app.current_data = data;
        app.current_params = params;
        app.current_display_turns = frames(frame_idx);
        set(fig, 'UserData', app);
        drawnow;
        pause(app.constants.animation_pause_s);
    end

    if ishandle(fig)
        app = get(fig, 'UserData');
        was_paused = app.pause_requested;
        final_turns = clamp_display_control(app.current_display_turns, params);
        app.is_animating = false;
        app.pause_requested = false;
        set(app.buttons.play, 'Enable', 'on');
        set(app.buttons.pause, 'Enable', 'off');
        set(fig, 'UserData', app);
        refresh_app(app, final_turns);
        if was_paused && ishandle(fig)
            app = get(fig, 'UserData');
            set(app.status, 'String', sprintf( ...
                '상태: 일시정지됨.   %s 기준으로 표시 중', ...
                format_control_status(params, final_turns)));
            set(fig, 'UserData', app);
        end
    end
end

%% ========================================================================
%  앱 갱신
% =========================================================================
function refresh_app(app, display_turns)
    params = read_params_from_ui(app);
    display_turns = clamp_display_control(display_turns, params);
    data = compute_poynting_data(params.H, params.Re_m, params.mu_pa, ...
        params.mass_kg, params.max_turns, params.max_torque_Nm, app.constants);

    update_input_text(app, params);
    render_visualization(app, data, params, display_turns);
    render_graphs(app, data, params, display_turns);
    render_equations(app);
    update_outputs(app, data, params, display_turns);

    app.current_data = data;
    app.current_params = params;
    app.current_display_turns = display_turns;
    set(app.fig, 'UserData', app);
    drawnow;
end

function params = read_params_from_ui(app)
    params.H_mm = get(app.sliders(1), 'Value');
    params.H = params.H_mm / 1000;
    params.Re_mm = get(app.sliders(2), 'Value');
    params.mu_psi = get(app.sliders(3), 'Value');
    params.mass_kg = get(app.sliders(4), 'Value');
    params.max_turns = app.constants.twist_control_max_turns;
    params.max_torque_Nm = app.constants.torque_control_max_Nm;

    params.Re_m = params.Re_mm / 1000;
    params.mu_pa = params.mu_psi * app.constants.psi_to_pa;
    params.force_N = params.mass_kg * app.constants.g;
    selected_mode = get(app.panels.mode, 'SelectedObject');
    params.mode = get(selected_mode, 'Tag');
    params.show_reference = get(app.controls.show_reference, 'Value') == 1;
end

function update_input_text(app, params)
    values = [params.H_mm, params.Re_mm, params.mu_psi, params.mass_kg];
    for idx = 1:numel(app.edit_boxes)
        fmt = app.slider_defs{idx, 7};
        set(app.edit_boxes(idx), 'String', format_control_value(values(idx), fmt));
    end
end

function update_outputs(app, data, params, display_turns)
    active = get_active_state(data, params, display_turns);

    set(app.readouts.equilibrium_height, 'String', sprintf('%.5f m', active.height_m));
    set(app.readouts.equilibrium_radius, 'String', sprintf('%.4f mm', active.radius_m * 1000));
    set(app.readouts.elongation, 'String', sprintf('%.4f mm', active.delta_mm));
    set(app.readouts.twist_delta, 'String', sprintf('%.4f mm', active.twist_delta_mm));
    set(app.readouts.relative_height, 'String', sprintf('%.4f', active.height_m / params.H));
    set(app.readouts.initial_volume, 'String', sprintf('%.4e m^3', data.initial_volume_m3));
    set(app.readouts.current_volume, 'String', sprintf('%.4e m^3', active.volume_m3));
    set(app.readouts.volume_ratio, 'String', sprintf('%.4f', active.volume_m3 / data.initial_volume_m3));
    set(app.readouts.force, 'String', sprintf('%.3f N', params.force_N));
    set(app.readouts.torque, 'String', sprintf('%.6f N m', active.torque_Nm));

    mode_text = get_mode_text(params.mode);

    set(app.status, 'String', sprintf( ...
        '상태: 평형 계산 완료.   모드: %s   %s   h = %.5f m   r = %.5f m   부피비 = %.4f', ...
        mode_text, format_control_status(params, display_turns), active.height_m, active.radius_m, ...
        active.volume_m3 / data.initial_volume_m3));
end

%% ========================================================================
%  물리 계산
% =========================================================================
function data = compute_poynting_data(H, Re_m, mu_pa, mass_kg, max_turns, max_torque_Nm, constants)
    turns = linspace(0, max_turns, constants.sample_count);
    theta_rad = turns * 2 * pi;
    torque_Nm = linspace(0, max_torque_Nm, constants.sample_count);
    force_N = mass_kg * constants.g;

    loaded_height_m = zeros(size(turns));
    unloaded_height_m = zeros(size(turns));
    required_torque_Nm = zeros(size(turns));
    torque_height_m = zeros(size(torque_Nm));
    torque_theta_rad = zeros(size(torque_Nm));

    if force_N == 0
        a_param = 0;
    else
        a_param = force_N / (mu_pa * pi * Re_m^2);
    end

    for idx = 1:numel(turns)
        theta = theta_rad(idx);
        b_param = (Re_m * theta)^2 / (4 * H^2);

        unloaded_height_m(idx) = H * (1 + b_param)^(1/3);
        loaded_height_m(idx) = solve_loaded_height(H, a_param, b_param, constants.min_root_tol);
        required_torque_Nm(idx) = theta * mu_pa * pi * Re_m^4 / (2 * loaded_height_m(idx));
    end

    for idx = 1:numel(torque_Nm)
        M = torque_Nm(idx);
        torque_param = M^2 / (mu_pa^2 * pi^2 * Re_m^6);
        torque_height_m(idx) = solve_loaded_height(H, a_param + torque_param, 0, constants.min_root_tol);
        torque_theta_rad(idx) = 2 * torque_height_m(idx) * M / (mu_pa * pi * Re_m^4);
    end

    loaded_radius_m = sqrt(H ./ loaded_height_m) * Re_m;
    unloaded_radius_m = sqrt(H ./ unloaded_height_m) * Re_m;
    torque_radius_m = sqrt(H ./ torque_height_m) * Re_m;

    data.turns = turns;
    data.theta_rad = theta_rad;
    data.loaded_height_m = loaded_height_m;
    data.unloaded_height_m = unloaded_height_m;
    data.loaded_radius_m = loaded_radius_m;
    data.unloaded_radius_m = unloaded_radius_m;
    data.loaded_delta_mm = (loaded_height_m - H) * 1000;
    data.unloaded_delta_mm = (unloaded_height_m - H) * 1000;
    data.loaded_twist_delta_mm = (loaded_height_m - loaded_height_m(1)) * 1000;
    data.unloaded_twist_delta_mm = (unloaded_height_m - unloaded_height_m(1)) * 1000;
    data.approx_delta_mm = (Re_m^2 .* theta_rad.^2 ./ (12 * H)) * 1000;
    data.required_torque_Nm = required_torque_Nm;
    data.torque_Nm = torque_Nm;
    data.torque_theta_rad = torque_theta_rad;
    data.torque_turns = torque_theta_rad / (2 * pi);
    data.torque_height_m = torque_height_m;
    data.torque_radius_m = torque_radius_m;
    data.torque_delta_mm = (torque_height_m - H) * 1000;
    data.torque_twist_delta_mm = (torque_height_m - torque_height_m(1)) * 1000;
    data.force_N = force_N;
    data.initial_volume_m3 = pi * Re_m^2 * H;
end

function loaded_height_m = solve_loaded_height(H, a_param, b_param, tol)
    coeffs = [1, -a_param, 0, -(b_param + 1)];
    roots_all = roots(coeffs);
    real_roots = real(roots_all(abs(imag(roots_all)) < tol));
    valid_roots = real_roots(real_roots >= 1 - tol & isfinite(real_roots));

    if isempty(valid_roots)
        warning('PoyntingSimulation:InvalidRoot', ...
            '유효한 평형 높이 해를 찾지 못해 초기 높이를 사용합니다.');
        lambda = 1;
    else
        lambda = max(valid_roots);
    end

    loaded_height_m = max(H, lambda * H);
end

%% ========================================================================
%  렌더링
% =========================================================================
function render_visualization(app, data, params, display_turns)
    ax = app.ax3d;
    active = get_active_state(data, params, display_turns);
    H = params.H;
    Re_m = params.Re_m;
    theta_display = active.theta_rad;
    text_color = [0.08 0.08 0.08];

    legend(ax, 'off');
    cla(ax); hold(ax, 'on'); grid(ax, 'on'); box(ax, 'on');
    axis(ax, 'equal');
    view(ax, 28, 22);
    title(ax, sprintf('비틀림 각도  \\theta = %.1f deg,  M = %.4f N m,  R_e = %.2f mm', ...
        active.theta_rad * 180 / pi, active.torque_Nm, params.Re_mm), ...
        'FontSize', 12, 'FontWeight', 'bold', 'Color', text_color);
    radial_scale = visualization_radius_scale(params);
    frame_radius = visualization_frame_radius(params);
    xy_label = '시각화 좌표';
    xlabel(ax, sprintf('x (%s)', xy_label), 'Color', text_color, 'FontWeight', 'bold');
    ylabel(ax, sprintf('y (%s)', xy_label), 'Color', text_color, 'FontWeight', 'bold');
    zlabel(ax, 'z (m)', 'Color', text_color, 'FontWeight', 'bold');
    set(ax, 'XColor', text_color, 'YColor', text_color, 'ZColor', text_color, ...
        'FontWeight', 'bold');

    R_vis = Re_m * radial_scale;
    r_vis = active.radius_m * radial_scale;

    n_circ = 56;
    n_h = 72;
    u = linspace(0, 2*pi, n_circ);
    v = linspace(0, 1, n_h);
    [U, V] = meshgrid(u, v);

    h_ref = [];
    if params.show_reference
        X0 = R_vis * cos(U);
        Y0 = R_vis * sin(U);
        Z0 = H * V;
        h_ref = surf(ax, X0, Y0, Z0, ...
            'FaceColor', [0.72 0.72 0.72], ...
            'EdgeColor', 'none', ...
            'FaceAlpha', 0.24, ...
            'FaceLighting', 'gouraud');
        plot3(ax, R_vis*cos(u), R_vis*sin(u), H*ones(size(u)), ...
            'Color', [0.35 0.35 0.35], 'LineWidth', 0.9, ...
            'HandleVisibility', 'off');
        plot3(ax, R_vis*cos(u), R_vis*sin(u), zeros(size(u)), ...
            'Color', [0.35 0.35 0.35], 'LineWidth', 0.9, ...
            'HandleVisibility', 'off');
    end

    X = r_vis * cos(U + theta_display * V);
    Y = r_vis * sin(U + theta_display * V);
    Z = active.height_m * V;
    h_def = surf(ax, X, Y, Z, ...
        'FaceColor', [1.00 0.58 0.16], ...
        'EdgeColor', 'none', ...
        'FaceAlpha', 0.82, ...
        'FaceLighting', 'gouraud');
    plot3(ax, r_vis*cos(u), r_vis*sin(u), zeros(size(u)), ...
        'k-', 'LineWidth', 1.0, 'HandleVisibility', 'off');
    plot3(ax, r_vis*cos(u + theta_display), r_vis*sin(u + theta_display), ...
        active.height_m*ones(size(u)), 'k-', 'LineWidth', 1.0, ...
        'HandleVisibility', 'off');

    v_helix = linspace(0, 1, 13);
    h_helix = plot3(ax, r_vis*cos(theta_display*v_helix), ...
        r_vis*sin(theta_display*v_helix), active.height_m*v_helix, 'o', ...
        'Color', [0.08 0.22 0.75], ...
        'MarkerFaceColor', [0.08 0.22 0.75], ...
        'MarkerSize', 3.5, 'LineStyle', 'none');

    arrow_r = max(r_vis, R_vis) * 1.25;
    arc = linspace(pi/2, pi/2 + min(theta_display, 1.4*pi), 60);
    plot3(ax, arrow_r*cos(arc), arrow_r*sin(arc), active.height_m*1.08*ones(size(arc)), ...
        'k-', 'LineWidth', 1.6, 'HandleVisibility', 'off');
    plot3(ax, arrow_r*cos(arc(end)), arrow_r*sin(arc(end)), active.height_m*1.08, ...
        'k>', 'MarkerSize', 7, 'MarkerFaceColor', 'k', 'HandleVisibility', 'off');
    text(ax, arrow_r*0.45, arrow_r*0.95, active.height_m*1.12, '\theta', ...
        'FontSize', 12, 'FontWeight', 'bold', 'Color', text_color);

    ruler_span = max([R_vis, r_vis, frame_radius * 0.42]);
    ruler_x = -ruler_span * 2.05;
    ruler_y = -ruler_span * 1.35;
    plot3(ax, [ruler_x ruler_x], [ruler_y ruler_y], [0 H], ...
        'Color', [0.08 0.08 0.08], 'LineWidth', 1.6, ...
        'HandleVisibility', 'off');
    text(ax, ruler_x*1.05, ruler_y, H/2, sprintf('H = %.3f m', H), ...
        'FontSize', 9, 'Color', text_color, 'FontWeight', 'bold');

    ruler_x2 = ruler_span * 1.65;
    plot3(ax, [ruler_x2 ruler_x2], [0 0], [0 active.height_m], ...
        'Color', [1.0 0.35 0.0], 'LineWidth', 1.5, ...
        'HandleVisibility', 'off');
    text(ax, ruler_x2*1.05, 0, active.height_m/2, sprintf('h = %.4f m', active.height_m), ...
        'FontSize', 9, 'Color', [0.90 0.30 0.0], 'FontWeight', 'bold');

    if params.show_reference
        legend_handles = [h_ref, h_def, h_helix];
        legend_items = {'변형 전 기준', '변형 후 평형', '나선 기준점'};
    else
        legend_handles = [h_def, h_helix];
        legend_items = {'변형 후 평형', '나선 기준점'};
    end
    legend(ax, legend_handles, legend_items, 'Location', 'southeast', 'FontSize', 8);

    xy_lim = max([frame_radius * 2.45, R_vis * 1.35, r_vis * 1.35, H * 0.18]);
    z_top = max(H, active.height_m) * 1.20;
    xlim(ax, [-xy_lim, xy_lim]);
    ylim(ax, [-xy_lim, xy_lim]);
    zlim(ax, [-0.12*H, z_top]);
    camlight(ax, 'headlight');
    lighting(ax, 'gouraud');
end

function radial_scale = visualization_radius_scale(params)
    radius_min_mm = 2.0;
    radius_max_mm = 30.0;
    radius_range_mm = radius_max_mm - radius_min_mm;
    normalized_radius = (params.Re_mm - radius_min_mm) / radius_range_mm;
    normalized_radius = min(max(normalized_radius, 0), 1);
    target_radius_m = params.H * (0.055 + 0.110 * sqrt(normalized_radius));
    radial_scale = target_radius_m / max(params.Re_m, eps);
end

function frame_radius_m = visualization_frame_radius(params)
    frame_radius_m = params.H * 0.165;
end

function render_graphs(app, data, params, display_turns)
    active = get_active_state(data, params, display_turns);
    cla(app.axRadius);
    axis(app.axRadius, 'off');

    if strcmp(params.mode, 'torque_control')
        x = data.torque_Nm;
        active_x = active.torque_Nm;
        x_label = 'M (N m)';
        x_max = params.max_torque_Nm;
        plot_graph(app.axElongation, x, {data.torque_delta_mm}, active_x, active.delta_mm, ...
            '전체 신장: h - H', 'stress-free 기준 (mm)', x_label, x_max, {'전체 신장'});
        plot_graph(app.axHeight, x, {data.torque_twist_delta_mm}, active_x, active.twist_delta_mm, ...
            '비틀림 추가 신장: h(\theta) - h(0)', '하중 후 기준 (mm)', x_label, x_max, {'추가 신장'});
        return;
    end

    x = data.turns;
    active_x = display_turns;
    plot_graph(app.axElongation, x, {data.loaded_delta_mm}, ...
        active_x, active.delta_mm, '전체 신장: h - H', 'stress-free 기준 (mm)', ...
        '\theta / 2\pi (turns)', params.max_turns, {'전체 신장'});
    plot_graph(app.axHeight, x, {data.loaded_twist_delta_mm}, ...
        active_x, active.twist_delta_mm, '비틀림 추가 신장: h(\theta) - h(0)', '하중 후 기준 (mm)', ...
        '\theta / 2\pi (turns)', params.max_turns, {'추가 신장'});
end

function plot_graph(ax, x, series_values, active_x, active_y, title_text, y_label, x_label, x_max, legend_labels)
    text_color = [0.08 0.08 0.08];
    colors = [0.0 0.35 0.85; 0.88 0.12 0.08; 0.18 0.48 0.41];
    styles = {'--', '-', '-'};
    cla(ax); hold(ax, 'on'); grid(ax, 'on'); box(ax, 'on');
    all_y = active_y;
    for idx = 1:numel(series_values)
        y = series_values{idx};
        color_idx = min(idx, size(colors, 1));
        plot(ax, x, y, 'Color', colors(color_idx, :), ...
            'LineStyle', styles{min(idx, numel(styles))}, 'LineWidth', 1.7);
        all_y = [all_y; y(:)]; %#ok<AGROW>
    end
    plot(ax, active_x, active_y, 'ko', 'MarkerSize', 5, 'MarkerFaceColor', [1.0 0.85 0.15]);

    title(ax, title_text, 'FontSize', 9.5, 'FontWeight', 'bold', 'Color', text_color);
    xlabel(ax, x_label, 'FontSize', 8.5, ...
        'Color', text_color, 'FontWeight', 'bold');
    ylabel(ax, y_label, 'FontSize', 8.5, ...
        'Color', text_color, 'FontWeight', 'bold');
    xlim(ax, [0, max(x_max, eps)]);

    y_min = min(all_y);
    y_max = max(all_y);
    if abs(y_max - y_min) < 1e-12
        y_max = y_max + 1;
    end
    pad = 0.12 * abs(y_max - y_min);
    ylim(ax, [y_min - pad, y_max + pad]);
    set(ax, 'FontSize', 8, 'XColor', text_color, 'YColor', text_color, ...
        'FontWeight', 'bold');
    if nargin >= 10 && ~isempty(legend_labels)
        legend(ax, legend_labels, 'Location', 'northwest', 'FontSize', 7);
    end
end

function render_equations(app)
    ax = app.axEquations;
    text_color = [0.08 0.08 0.08];
    cla(ax);
    axis(ax, 'off');

    text(ax, 0.03, 0.82, '질량 0 비틀림 (Eq. 13):', ...
        'Units', 'normalized', 'FontSize', 9, 'FontWeight', 'bold', ...
        'Color', text_color);
    text(ax, 0.08, 0.65, '$h^* = H\left(1 + \frac{R_e^2\theta^2}{4H^2}\right)^{1/3}$', ...
        'Units', 'normalized', 'FontSize', 10.5, 'Interpreter', 'latex', ...
        'Color', text_color);
    text(ax, 0.03, 0.47, '비틀림 각도 지정 (Eq. 15):', ...
        'Units', 'normalized', 'FontSize', 9, 'FontWeight', 'bold', ...
        'Color', text_color); 
    text(ax, 0.08, 0.31, '$\left(\frac{h}{H}\right)^3 - \frac{F}{\mu\pi R_e^2}\left(\frac{h}{H}\right)^2 - \left(1 + \frac{R_e^2\theta^2}{4H^2}\right)=0$', ...
        'Units', 'normalized', 'FontSize', 8.7, 'Interpreter', 'latex', ...
        'Color', text_color);
    text(ax, 0.03, 0.16, '토크 지정 (Sec. VII):', ...
        'Units', 'normalized', 'FontSize', 9, 'FontWeight', 'bold', ...
        'Color', text_color);
    text(ax, 0.08, 0.03, '$\left(\frac{h}{H}\right)^3-\left(\frac{F}{\mu\pi R_e^2}+\frac{M^2}{\mu^2\pi^2R_e^6}\right)\left(\frac{h}{H}\right)^2-1=0,\quad \theta=\frac{2hM}{\mu\pi R_e^4}$', ...
        'Units', 'normalized', 'FontSize', 7.3, 'Interpreter', 'latex', ...
        'Color', text_color);
end

%% ========================================================================
%  작은 헬퍼
% =========================================================================
function active = get_active_state(data, params, display_turns)
    a_param = force_coefficient(params);
    if strcmp(params.mode, 'torque_control')
        torque_Nm = clamp_display_control(display_turns, params);
        torque_param = torque_Nm^2 / (params.mu_pa^2 * pi^2 * params.Re_m^6);
        active.height_m = solve_loaded_height(params.H, a_param + torque_param, 0, 1e-10);
        active.radius_m = sqrt(params.H / active.height_m) * params.Re_m;
        active.delta_mm = (active.height_m - params.H) * 1000;
        zero_height_m = solve_loaded_height(params.H, a_param, 0, 1e-10);
        active.twist_delta_mm = (active.height_m - zero_height_m) * 1000;
        active.theta_rad = 2 * active.height_m * torque_Nm / (params.mu_pa * pi * params.Re_m^4);
        active.turns = active.theta_rad / (2 * pi);
        active.torque_Nm = torque_Nm;
        idx = nearest_value_index(data.torque_Nm, torque_Nm);
    else
        turns = clamp_display_control(display_turns, params);
        active.theta_rad = turns * 2 * pi;
        b_param = (params.Re_m * active.theta_rad)^2 / (4 * params.H^2);
        active.height_m = solve_loaded_height(params.H, a_param, b_param, 1e-10);
        active.radius_m = sqrt(params.H / active.height_m) * params.Re_m;
        active.delta_mm = (active.height_m - params.H) * 1000;
        zero_height_m = solve_loaded_height(params.H, a_param, 0, 1e-10);
        active.twist_delta_mm = (active.height_m - zero_height_m) * 1000;
        active.turns = turns;
        active.torque_Nm = active.theta_rad * params.mu_pa * pi * params.Re_m^4 / (2 * active.height_m);
        idx = nearest_value_index(data.turns, turns);
    end

    active.idx = idx;
    active.volume_m3 = pi * active.radius_m^2 * active.height_m;
end

function a_param = force_coefficient(params)
    if params.force_N == 0
        a_param = 0;
    else
        a_param = params.force_N / (params.mu_pa * pi * params.Re_m^2);
    end
end

function idx = nearest_value_index(values, display_value)
    [~, idx] = min(abs(values - display_value));
end

function display_value = clamp_display_control(display_value, params)
    if isempty(display_value) || ~isfinite(display_value)
        display_value = 0;
    end
    display_value = max(0, min(get_control_max(params), display_value));
end

function max_control = get_control_max(params)
    if strcmp(params.mode, 'torque_control')
        max_control = params.max_torque_Nm;
    else
        max_control = params.max_turns;
    end
    max_control = max(max_control, eps);
end

function mode_text = get_mode_text(mode_tag)
    if strcmp(mode_tag, 'torque_control')
        mode_text = '토크 지정';
    else
        mode_text = '비틀림 각도 지정';
    end
end

function text_value = format_control_status(params, display_value)
    if strcmp(params.mode, 'torque_control')
        text_value = sprintf('M = %.6f N m', display_value);
    else
        text_value = sprintf('theta = %.2f turns (%.1f deg)', display_value, display_value * 360);
    end
end

function text_value = format_control_value(value, fmt)
    text_value = sprintf(fmt, value);
end
