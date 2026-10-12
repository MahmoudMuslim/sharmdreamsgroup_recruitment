/**
 * Sharm Dreams Group - Custom HR Application
 * Client Script: Job Applicant Form Extension
 * File: sharm_dreams_hr/public/js/job_applicant.js
 * Description: Adds AI Recruiter Actions, WhatsApp Direct Chat/Invite, and Color-Coded Fit Scores.
 */

frappe.ui.form.on('Job Applicant', {
    refresh: function(frm) {
        // Apply visual styling to AI Fit Score indicator
        apply_ai_score_indicator_styling(frm);

        if (!frm.is_new()) {
            setup_ai_recruiter_action_buttons(frm);
            setup_whatsapp_action_buttons(frm);
            setup_cv_parser_action_buttons(frm);
        }
    },

    custom_ai_score: function(frm) {
        apply_ai_score_indicator_styling(frm);
    }
});

/**
 * Adds AI Evaluation button group to form
 */
function setup_ai_recruiter_action_buttons(frm) {
    frm.add_custom_button(__('Run AI Evaluation'), function() {
        frappe.confirm(
            __('Run automated AI screening for candidate <b>{0}</b> based on sector <b>{1}</b>?', [
                frm.doc.applicant_name,
                frm.doc.custom_business_sector || 'Hospitality'
            ]),
            function() {
                frappe.show_progress(__('Screening Candidate'), 40, 100, __('Consulting OpenRouter LLM...'));

                frappe.call({
                    method: 'sharm_dreams_hr.api.ai_recruiter.evaluate_job_applicant',
                    args: {
                        applicant_name: frm.doc.name
                    },
                    freeze: true,
                    freeze_message: __('Sharm Dreams AI Hub is screening candidate profile and CV...'),
                    callback: function(r) {
                        frappe.hide_progress();
                        if (r.message && r.message.status === 'success') {
                            frappe.show_alert({
                                message: __('AI Evaluation Complete: Fit Score {0}%', [r.message.fit_score]),
                                indicator: r.message.fit_score >= 75 ? 'green' : (r.message.fit_score >= 50 ? 'orange' : 'red')
                            }, 7);
                            frm.reload_doc();
                        } else {
                            frappe.msgprint({
                                title: __('AI Recruiter Notice'),
                                message: r.message ? r.message.message : __('Evaluation completed.'),
                                indicator: 'blue'
                            });
                            frm.reload_doc();
                        }
                    },
                    error: function(err) {
                        frappe.hide_progress();
                        frappe.msgprint({
                            title: __('Evaluation Failed'),
                            message: __('Check OpenRouter API key configuration in site_config.json'),
                            indicator: 'red'
                        });
                    }
                });
            }
        );
    }, __('AI Actions')).addClass('btn-primary');
}

/**
 * Adds WhatsApp communication button group
 */
function setup_whatsapp_action_buttons(frm) {
    var rawPhone = frm.doc.phone_number || frm.doc.custom_whatsapp_chat_id || '';
    var cleanPhone = rawPhone.replace(/\D/g, '');

    // 1. Direct WhatsApp Chat via wa.me
    frm.add_custom_button(__('Open WhatsApp Chat'), function() {
        if (!cleanPhone) {
            frappe.msgprint(__('Candidate does not have a phone number specified.'));
            return;
        }

        var message = encodeURIComponent(
            `Hello ${frm.doc.applicant_name}, this is Talent Acquisition from Sharm Dreams Group regarding your application for ${frm.doc.job_title || 'the open position'}.`
        );
        var waUrl = `https://wa.me/${cleanPhone}?text=${message}`;
        window.open(waUrl, '_blank');
    }, __('WhatsApp'));

    // 2. Send Automated Interview Invite template
    frm.add_custom_button(__('Send Interview Invite'), function() {
        if (!cleanPhone) {
            frappe.msgprint(__('Candidate has no valid phone number.'));
            return;
        }

        var d = new frappe.ui.Dialog({
            title: __('Schedule WhatsApp Interview Invite'),
            fields: [
                {
                    label: __('Candidate Name'),
                    fieldname: 'candidate_name',
                    fieldtype: 'Data',
                    default: frm.doc.applicant_name,
                    read_only: 1
                },
                {
                    label: __('Target Subsidiary'),
                    fieldname: 'company',
                    fieldtype: 'Data',
                    default: frm.doc.company || 'Sharm Dreams Group',
                    read_only: 1
                },
                {
                    label: __('Proposed Date & Time'),
                    fieldname: 'interview_datetime',
                    fieldtype: 'Datetime',
                    reqd: 1,
                    default: frappe.datetime.add_days(frappe.datetime.now_datetime(), 2)
                },
                {
                    label: __('Interview Location / Platform'),
                    fieldname: 'location',
                    fieldtype: 'Select',
                    options: 'Resort HR Office (Sharm El Sheikh)\nCairo Executive HQ (Mohandessin)\nOnline (Google Meet / Microsoft Teams)',
                    default: 'Resort HR Office (Sharm El Sheikh)',
                    reqd: 1
                }
            ],
            primary_action_label: __('Send via WhatsApp'),
            primary_action: function(values) {
                d.hide();
                frappe.call({
                    method: 'sharm_dreams_hr.api.omnichannel.send_whatsapp_interview_invite',
                    args: {
                        applicant_name: frm.doc.name,
                        interview_datetime: values.interview_datetime,
                        location: values.location
                    },
                    freeze: true,
                    freeze_message: __('Dispatching WhatsApp invitation...'),
                    callback: function(res) {
                        if (res.message) {
                            frappe.show_alert({
                                message: res.message.message,
                                indicator: res.message.status === 'success' ? 'green' : 'orange'
                            }, 5);
                            frm.reload_doc();
                        }
                    }
                });
            }
        });
        d.show();
    }, __('WhatsApp'));
}

/**
 * Adds CV Text Parsing button
 */
function setup_cv_parser_action_buttons(frm) {
    frm.add_custom_button(__('Extract CV Text from PDF'), function() {
        frappe.call({
            method: 'sharm_dreams_hr.utils.cv_parser.parse_applicant_resume',
            args: {
                applicant_name: frm.doc.name
            },
            freeze: true,
            freeze_message: __('Parsing attached PDF resume with PyPDF...'),
            callback: function(r) {
                if (r.message) {
                    frappe.show_alert({
                        message: r.message.message,
                        indicator: r.message.status === 'success' ? 'green' : 'orange'
                    });
                    frm.reload_doc();
                }
            }
        });
    }, __('AI Actions'));
}

/**
 * Color-codes the AI Fit Score badge and form display
 * Green (>=75%), Yellow/Orange (50-74%), Red (<50%)
 */
function apply_ai_score_indicator_styling(frm) {
    var score = frm.doc.custom_ai_score;
    if (score === null || score === undefined || score === '') {
        frm.page.set_indicator(__('Unscreened'), 'gray');
        return;
    }

    score = flt(score);

    var indicatorColor = 'red';
    var label = __('Low Fit ({0}%)', [score]);

    if (score >= 75) {
        indicatorColor = 'green';
        label = __('Strong Match ({0}%)', [score]);
    } else if (score >= 50) {
        indicatorColor = 'orange';
        label = __('Moderate Match ({0}%)', [score]);
    }

    // Set page header status badge
    frm.page.set_indicator(label, indicatorColor);

    // Apply color highlight to the form field wrapper
    setTimeout(function() {
        var $field = frm.get_field('custom_ai_score');
        if ($field && $field.$wrapper) {
            $field.$wrapper.find('.control-value').css({
                'font-weight': '700',
                'font-size': '1.2rem',
                'color': score >= 75 ? '#10b981' : (score >= 50 ? '#f59e0b' : '#ef4444')
            });
        }
    }, 200);
}
